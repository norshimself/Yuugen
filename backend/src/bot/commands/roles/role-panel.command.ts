import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelOption, Context, IntegerOption, Options,
  RoleOption, StringOption, Subcommand,
} from 'necord';
import type { SlashCommandContext } from 'necord';
import {
  ChannelType, ChatInputCommandInteraction, Guild, GuildMember,
  MessageFlags, PermissionFlagsBits, Role, TextChannel, escapeMarkdown,
} from 'discord.js';
import { RolePanelService } from '../../../domain/roles/role-panel.service';
import {
  SNOWFLAKE, roleConfigurationDenial, type RolePanelMode,
} from '../../../domain/roles/role-panel-policy';
import { renderRolePanel } from '../../../domain/roles/role-panel-renderer';
import { RoleGroup } from './role-group';

class CreateOptions {
  @ChannelOption({
    name: 'channel',
    description: 'Server text channel where the panel will be published',
    required: true,
    channelTypes: [ChannelType.GuildText],
  })
  channel: TextChannel;

  @StringOption({
    name: 'title',
    description: 'Title of the published role menu (up to 100 characters)',
    required: true,
  })
  title: string;

  @StringOption({
    name: 'mode',
    description: 'Choose buttons or select (dropdown) menu',
    required: true,
  })
  mode: string;
}

class AddOptions {
  @IntegerOption({
    name: 'panel_id', description: 'Draft panel ID', required: true,
    minValue: 1,
  })
  panelId: number;

  @RoleOption({
    name: 'role', description: 'Role a member may toggle', required: true,
  })
  role: Role;

  @StringOption({
    name: 'label', description: 'Button or dropdown label (up to 80 characters)',
    required: true,
  })
  label: string;

  @StringOption({
    name: 'exclusive_group',
    description: 'Optional shared group key (e.g. color or region)',
    required: false,
  })
  groupKey?: string;

  @RoleOption({
    name: 'requires',
    description: 'Optional prerequisite role the member must already hold',
    required: false,
  })
  prerequisite?: Role;
}

class RemoveOptions {
  @IntegerOption({
    name: 'panel_id', description: 'Draft panel ID', required: true,
    minValue: 1,
  })
  panelId: number;

  @IntegerOption({
    name: 'option_id', description: 'Option ID to remove from a draft panel',
    required: true, minValue: 1,
  })
  optionId: number;
}
class PanelIdOptions {
  @IntegerOption({
    name: 'panel_id', description: 'Panel ID to publish or disable',
    required: true, minValue: 1,
  })
  panelId: number;
}

interface ManagerContext {
  guild: Guild;
  manager: GuildMember;
  bot: GuildMember | null;
}

@RoleGroup({
  name: 'panel',
  description: 'Configure member self-assignable role buttons and dropdowns',
})
@Injectable()
export class RolePanelCommands {
  private readonly logger = new Logger(RolePanelCommands.name);

  constructor(private readonly panels: RolePanelService) {}

  /** Never trust cached actor roles or client-side slash-command visibility. */
  private async managerContext(
    interaction: ChatInputCommandInteraction,
  ): Promise<ManagerContext | null> {
    const guild = interaction.guild;
    if (!guild || !interaction.guildId) return null;
    const manager = await guild.members.fetch({
      user: interaction.user.id, force: true,
    }).catch(() => null);
    if (!manager ||
        !manager.permissions.has(PermissionFlagsBits.ManageGuild) ||
        !manager.permissions.has(PermissionFlagsBits.ManageRoles)) return null;
    const bot = await guild.members.fetchMe().catch(() => null);
    return { guild, manager, bot };
  }

  /** Always validate bot hierarchy and dangerous flags, including at publish. */
  private async checkRole(
    staff: ManagerContext, roleId: string,
  ): Promise<string | null> {
    const role = SNOWFLAKE.test(roleId)
      ? await staff.guild.roles.fetch(roleId, { force: true }).catch(() => null)
      : null;
    if (!role) return 'The selected role was deleted or is unavailable.';
    if (!staff.bot) return 'The bot member could not be verified.';
    const denial = roleConfigurationDenial({
      guildId: staff.guild.id, roleGuildId: role.guild.id,
      roleId: role.id, isEveryone: role.id === staff.guild.id,
      managed: role.managed,
      botHasManageRoles: staff.bot.permissions.has(PermissionFlagsBits.ManageRoles),
      botIsAboveRole: staff.bot.roles.highest.comparePositionTo(role) > 0,
      permissionBits: role.permissions.bitfield,
    });
    return denial || (role.manageable ? null :
      'The bot cannot manage this role at its current hierarchy position.');
  }

  @Subcommand({ name: 'create', description: 'Create an unpublished draft role panel' })
  public async onCreate(
    @Context() [interaction]: SlashCommandContext,
    @Options() { channel, title, mode }: CreateOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const staff = await this.managerContext(interaction);
    if (!staff) return interaction.editReply(
      'Manage Server and Manage Roles permissions are required.',
    );
    if (!channel || channel.guildId !== staff.guild.id ||
        channel.type !== ChannelType.GuildText ||
        (mode !== 'buttons' && mode !== 'select')) {
      return interaction.editReply('Choose a text channel in this server and mode buttons or select.');
    }
    try {
      const panel = await this.panels.createDraft(
        staff.guild.id, channel.id, interaction.user.id,
        title, mode as RolePanelMode,
      );
      return interaction.editReply({
        content: 'Draft role panel #' + panel.id + ' created. Add options with ' +
          '/role panel add, then publish with /role panel publish. ' +
          'Options cannot be changed after publishing.',
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.logger.warn('Role panel creation rejected', error);
      return interaction.editReply('Could not create panel. Check its title, server quota and database.');
    }
  }

  @Subcommand({ name: 'add', description: 'Add a safe role option to a draft panel' })
  public async onAdd(
    @Context() [interaction]: SlashCommandContext,
    @Options() { panelId, role, label, groupKey, prerequisite }: AddOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const staff = await this.managerContext(interaction);
    if (!staff) return interaction.editReply('Manage Server and Manage Roles are required.');
    const denial = await this.checkRole(staff, role?.id);
    if (denial) return interaction.editReply(denial);
    if (prerequisite) {
      const prerequisiteRole = await staff.guild.roles
        .fetch(prerequisite.id, { force: true }).catch(() => null);
      if (!prerequisiteRole || prerequisiteRole.guild.id !== staff.guild.id) {
        return interaction.editReply('The prerequisite role must exist in this server.');
      }
    }
    try {
      const updated = await this.panels.addOption(
        staff.guild.id, panelId, role.id, label,
        groupKey || null, prerequisite?.id || null,
      );
      const added = updated.options[updated.options.length - 1];
      return interaction.editReply({
        content: 'Added option #' + added.id + ' to draft panel #' + panelId +
          ' (' + updated.options.length + ' options configured).',
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.logger.warn('Role panel option rejected', error);
      return interaction.editReply('Cannot add option: invalid, duplicate, cyclic, incompatible or no longer a draft.');
    }
  }

  @Subcommand({ name: 'remove', description: 'Remove an option from a draft role panel' })
  public async onRemove(
    @Context() [interaction]: SlashCommandContext,
    @Options() { panelId, optionId }: RemoveOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const staff = await this.managerContext(interaction);
    if (!staff) return interaction.editReply('Manage Server and Manage Roles are required.');
    try {
      const updated = await this.panels.removeOption(staff.guild.id, panelId, optionId);
      return interaction.editReply('Removed draft option. ' +
        updated.options.length + ' remain. Existing published panels are unaffected.');
    } catch {
      return interaction.editReply('Could not remove option. Check the draft and option IDs.');
    }
  }

  @Subcommand({ name: 'list', description: 'List draft and published role panels' })
  public async onList(@Context() [interaction]: SlashCommandContext) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const staff = await this.managerContext(interaction);
    if (!staff) return interaction.editReply('Manage Server and Manage Roles are required.');
    try {
      const panels = await this.panels.listPanels(staff.guild.id);
      if (!panels.length) return interaction.editReply('No role panels in this server.');
      return interaction.editReply({
        content: panels.map(panel =>
          '#' + panel.id + ' ' + escapeMarkdown(panel.title) +
          ' — ' + panel.status + ' (' + panel.mode + ', ' +
          panel.options.length + ' options)',
        ).join('\n').slice(0, 1900),
        allowedMentions: { parse: [] },
      });
    } catch {
      return interaction.editReply('Panel list unavailable; check the database.');
    }
  }

  @Subcommand({ name: 'publish', description: 'Publish a draft panel after safety checks' })
  public async onPublish(
    @Context() [interaction]: SlashCommandContext,
    @Options() { panelId }: PanelIdOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const staff = await this.managerContext(interaction);
    if (!staff || !staff.bot) {
      return interaction.editReply('Manage Server/Manage Roles and an available bot member are required.');
    }
    const panel = await this.panels.getPanel(staff.guild.id, panelId).catch(() => null);
    if (!panel || panel.status !== 'draft' || !panel.options?.length) {
      return interaction.editReply('Choose a draft panel with at least one option.');
    }
    const channel = await staff.guild.channels.fetch(panel.channelId, { force: true })
      .catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText ||
        !channel.permissionsFor(staff.bot)?.has(PermissionFlagsBits.ViewChannel) ||
        !channel.permissionsFor(staff.bot)?.has(PermissionFlagsBits.SendMessages)) {
      return interaction.editReply('Panel destination must be a writable guild text channel.');
    }
    for (const option of panel.options) {
      const denial = await this.checkRole(staff, option.roleId);
      if (denial) return interaction.editReply('Cannot publish: ' + denial);
      if (option.prerequisiteRoleId) {
        const prerequisite = await staff.guild.roles
          .fetch(option.prerequisiteRoleId, { force: true }).catch(() => null);
        if (!prerequisite) return interaction.editReply(
          'Cannot publish: a prerequisite role was deleted.',
        );
      }
    }
    try {
      // A reserved publishing state prevents duplicate Discord sends.
      const reserved = await this.panels.beginPublish(staff.guild.id, panelId);
      const message = await channel.send(renderRolePanel(reserved));
      const active = await this.panels.activate(staff.guild.id, panelId, message.id);
      if (!active) {
        // The panel may have been disabled while posting: keep the message inert.
        await message.edit({ components: [] }).catch(() => null);
        return interaction.editReply(
          'Panel publication was not activated. Check the channel and disable the draft.',
        );
      }
      return interaction.editReply({
        content: 'Role panel #' + panelId + ' published in <#' + channel.id +
          '>! Members can now toggle its listed roles.',
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      // Discord may have sent a message before a timeout; no blind republish.
      this.logger.warn('Role panel publication uncertain; requires manual review', error);
      return interaction.editReply(
        'Publish outcome unconfirmed. Panel remains publishing/inactive. ' +
        'Inspect the channel, then disable it and create a new draft if needed.',
      );
    }
  }

  @Subcommand({ name: 'disable', description: 'Disable a panel and its interactions' })
  public async onDisable(
    @Context() [interaction]: SlashCommandContext,
    @Options() { panelId }: PanelIdOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const staff = await this.managerContext(interaction);
    if (!staff) return interaction.editReply('Manage Server and Manage Roles are required.');
    try {
      const panel = await this.panels.disable(staff.guild.id, panelId);
      if (!panel) return interaction.editReply('Panel not found or changed concurrently.');
      if (panel.messageId) {
        const channel = await staff.guild.channels.fetch(panel.channelId)
          .catch(() => null);
        if (channel?.type === ChannelType.GuildText) {
          const message = await channel.messages.fetch(panel.messageId)
            .catch(() => null);
          // Best effort UI cleanup; DB inactive state is authoritative.
          await message?.edit({ components: [] }).catch(() => null);
        }
      }
      return interaction.editReply('Panel #' + panelId +
        ' disabled. Existing member roles were not changed.');
    } catch (error) {
      this.logger.warn('Panel disable failed', error);
      return interaction.editReply('Could not verify panel disable; check database status.');
    }
  }
}
