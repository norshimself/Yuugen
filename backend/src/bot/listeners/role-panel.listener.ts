import { Injectable, Logger } from '@nestjs/common';
import {
  Guild, GuildMember, MessageFlags,
  PermissionFlagsBits, Role,
} from 'discord.js';
import { Context, On } from 'necord';
import type { ContextOf } from 'necord';
import { RolePanelService } from '../../domain/roles/role-panel.service';
import {
  ROLE_COMPONENT_PREFIX, planRoleToggle, parseRoleComponent,
  roleConfigurationDenial, validatePanelOptions,
  type RolePanelOption,
} from '../../domain/roles/role-panel-policy';

type ActionStatus = 'added' | 'removed' | 'partial' | 'uncertain' | 'denied';

/**
 * Dynamic custom IDs survive bot restart. Never trust the component payload:
 * the panel, message, channel, guild, option, and member are all rechecked
 * from authoritative sources before any role operation.
 */
@Injectable()
export class RolePanelListener {
  private readonly logger = new Logger(RolePanelListener.name);

  constructor(private readonly panels: RolePanelService) {}

  private async manageable(
    guild: Guild, bot: GuildMember, roleId: string,
  ): Promise<string | null> {
    const role: Role | null = await guild.roles.fetch(roleId, { force: true })
      .catch(() => null);
    if (!role) return 'An option role no longer exists.';
    const error = roleConfigurationDenial({
      guildId: guild.id, roleGuildId: role.guild.id,
      roleId: role.id, isEveryone: role.id === guild.id,
      managed: role.managed,
      botHasManageRoles: bot.permissions.has(PermissionFlagsBits.ManageRoles),
      botIsAboveRole: bot.roles.highest.comparePositionTo(role) > 0,
      permissionBits: role.permissions.bitfield,
    });
    return error || (role.manageable ? null :
      'Yuugen cannot manage a role in this panel.');
  }

  @On('interactionCreate')
  public async onInteraction(
    @Context() [interaction]: ContextOf<'interactionCreate'>,
  ): Promise<void> {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith(ROLE_COMPONENT_PREFIX + ':')) return;

    const selected = interaction.isStringSelectMenu() &&
      interaction.values.length === 1 ? interaction.values[0] : undefined;
    const parsed = parseRoleComponent(interaction.customId, selected);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
    if (!interaction.deferred) return;
    if (!parsed || !interaction.guildId || !interaction.guild ||
        !interaction.channelId) {
      await interaction.editReply('This role menu control is invalid or outside a server.');
      return;
    }

    const guild = interaction.guild;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    let lease: { token: string; coolingDown: boolean } | null = null;
    let attemptedMutation = false;
    let auditId: number | null = null;
    let status: ActionStatus | null = null;
    try {
      const panel = await this.panels.getPanel(guildId, parsed.panelId);
      if (!panel || panel.status !== 'active' ||
          panel.guildId !== guildId || panel.channelId !== interaction.channelId ||
          panel.messageId !== interaction.message.id ||
          panel.mode !== parsed.mode || panel.revision !== parsed.revision ||
          validatePanelOptions(panel.mode, panel.options)) {
        await interaction.editReply('This role panel is disabled, stale, or not the original message.');
        return;
      }
      const option: RolePanelOption | undefined = panel.options.find(item =>
        item.id === parsed.optionId);
      if (!option) {
        await interaction.editReply('That option is no longer available.');
        return;
      }
      lease = await this.panels.acquireMember(guildId, userId);
      if (!lease) {
        await interaction.editReply('Another role change is already being processed. Try again later.');
        return;
      }
      if (lease.coolingDown) {
        await interaction.editReply('Role change just processed. Wait a few seconds before trying again.');
        return;
      }
      // A panel can be disabled while a member is awaiting the DB lease.
      const current = await this.panels.getPanel(guildId, parsed.panelId);
      if (!current || current.status !== 'active' ||
          current.revision !== parsed.revision ||
          current.messageId !== interaction.message.id ||
          current.channelId !== interaction.channelId) {
        await interaction.editReply('Role panel settings changed. No roles were touched.');
        return;
      }

      // Fetch both member and bot over REST; no privileged Guild Members
      // gateway intent or cached member roles is required.
      const [member, bot] = await Promise.all([
        guild.members.fetch({ user: userId, force: true }).catch(() => null),
        guild.members.fetchMe({ force: true }).catch(() => null),
      ]);
      if (!member || !bot || member.user.bot || !bot.permissions.has(
        PermissionFlagsBits.ManageRoles)) {
        await interaction.editReply('Could not verify member, bot or Manage Roles permissions.');
        return;
      }
      const selectedNow = current.options.find(item => item.id === parsed.optionId);
      if (!selectedNow || selectedNow.roleId !== option.roleId) {
        await interaction.editReply('The selected role is no longer available.');
        return;
      }
      const currentRoleIds = new Set(member.roles.cache.keys());
      const { plan, denial } = planRoleToggle(
        selectedNow, current.options, currentRoleIds,
      );
      if (denial || !plan) {
        await interaction.editReply(denial || 'This role selection is not allowed.');
        return;
      }
      // Check every role about to be mutated. A deleted/moved group peer
      // must never be "ignored" when enforcing exclusivity.
      for (const roleId of [plan.roleId, ...plan.removeRoleIds]) {
        const error = await this.manageable(guild, bot, roleId);
        if (error) {
          await interaction.editReply(error);
          return;
        }
      }
      if (selectedNow.prerequisiteRoleId && plan.operation === 'add') {
        const prerequisite = await guild.roles
          .fetch(selectedNow.prerequisiteRoleId, { force: true }).catch(() => null);
        if (!prerequisite || !member.roles.cache.has(prerequisite.id)) {
          await interaction.editReply('You no longer meet the prerequisite role requirement.');
          return;
        }
      }

      auditId = await this.panels.beginAction(
        interaction.id, guildId, userId,
        panel.id, selectedNow.id, selectedNow.roleId,
      );
      if (!auditId) {
        await interaction.editReply('This interaction was already handled.');
        return;
      }
      if (!await this.panels.hasMemberLease(guildId, userId, lease.token)) {
        status = 'denied';
        await interaction.editReply('Role change timed out before applying any change.');
        return;
      }
      const stillActive = await this.panels.getPanel(guildId, parsed.panelId);
      if (!stillActive || stillActive.status !== 'active' ||
          stillActive.revision !== current.revision ||
          stillActive.messageId !== interaction.message.id ||
          stillActive.channelId !== interaction.channelId) {
        status = 'denied';
        await interaction.editReply('The role panel was disabled before your role change.');
        return;
      }
      // The role membership API has idempotent single-role routes. Never
      // use member.roles.set(), which would overwrite unrelated staff roles.
      if (plan.operation === 'remove') {
        attemptedMutation = true;
        try {
          await member.roles.remove(plan.roleId, 'Yuugen self-role removal');
        } catch {
          status = 'uncertain';
          await interaction.editReply('Discord did not confirm removal. Staff should inspect your roles.');
          return;
        }
      } else {
        attemptedMutation = true;
        try {
          await member.roles.add(plan.roleId, 'Yuugen self-role selection');
        } catch {
          status = 'uncertain';
          await interaction.editReply('Discord did not confirm the role addition. Staff should inspect your roles.');
          return;
        }
        // Add first to avoid a temporary loss of the chosen group. If a
        // subsequent removal fails, report partial, never auto-retry/rollback.
        for (const oldRoleId of plan.removeRoleIds) {
          if (!await this.panels.hasMemberLease(guildId, userId, lease.token)) {
            status = 'partial';
            await interaction.editReply('Group change partially completed. Staff must reconcile your roles.');
            return;
          }
          const stillAllowed = await this.manageable(guild, bot, oldRoleId);
          if (stillAllowed) {
            status = 'partial';
            await interaction.editReply('A group role changed permissions mid-operation. Staff review needed.');
            return;
          }
          try {
            await member.roles.remove(oldRoleId, 'Yuugen exclusive role group');
          } catch {
            status = 'partial';
            await interaction.editReply('Exclusive-group removal was not confirmed. Staff must review your roles.');
            return;
          }
        }
      }
      // Verify outcome from Discord, not just a successful API response.
      const fresh = await guild.members.fetch({
        user: userId, force: true,
      }).catch(() => null);
      if (!fresh ||
          (plan.operation === 'add' &&
            (!fresh.roles.cache.has(plan.roleId) ||
              plan.removeRoleIds.some(roleId => fresh.roles.cache.has(roleId)))) ||
          (plan.operation === 'remove' && fresh.roles.cache.has(plan.roleId))) {
        status = 'uncertain';
        await interaction.editReply('Role outcome was not verified. Staff should inspect your roles.');
        return;
      }
      status = plan.operation === 'add' ? 'added' : 'removed';
      await interaction.editReply(
        plan.operation === 'add'
          ? 'Role added. Any conflicting selection in its exclusive group was removed.'
          : 'Role removed.',
      );
    } catch (error) {
      this.logger.warn('Role panel interaction failed without automatic retry', error);
      status = auditId ? 'uncertain' : null;
      await interaction.editReply(
        'Role change could not be verified. Please contact a moderator.',
      ).catch(() => null);
    } finally {
      if (auditId !== null && status) {
        await this.panels.finishAction(guildId, auditId, status).catch(error =>
          this.logger.error('Could not finalize role action audit', error));
      }
      if (lease) {
        await this.panels.releaseMember(
          guildId, userId, lease.token, attemptedMutation,
        ).catch(error => this.logger.error('Could not release role panel lease', error));
      }
    }
  }
}
