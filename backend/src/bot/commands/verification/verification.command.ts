import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChannelOption, Context, Options, RoleOption, StringOption,
  Subcommand, UserOption,
} from 'necord';
import type { SlashCommandContext } from 'necord';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType,
  ChatInputCommandInteraction, Guild, GuildMember, MessageFlags,
  PermissionFlagsBits, Role, TextChannel, User,
} from 'discord.js';
import { RolePanelService } from '../../../domain/roles/role-panel.service';
import { VerificationService } from '../../../domain/verification/verification.service';
import {
  buttonId, validJoinSession, type VerificationMode,
} from '../../../domain/verification/verification-policy';
import {
  canSafelyRemoveQuarantineRole, inspectVerificationEnvironment,
} from '../../../domain/verification/verification-discord';
import { VerificationGroup } from './verification-group';

class SetupOptions {
  @ChannelOption({
    name: 'channel', description: 'Text channel visible before verification',
    required: true, channelTypes: [ChannelType.GuildText],
  })
  channel: TextChannel;

  @RoleOption({
    name: 'quarantine_role',
    description: 'Empty-permission role used to restrict unverified members',
    required: true,
  })
  quarantineRole: Role;

  @StringOption({
    name: 'mode', description: 'button or question',
    required: true,
  })
  mode: string;

  @StringOption({
    name: 'question', description: 'Short challenge prompt (question mode only)',
    required: false,
  })
  question?: string;

  @StringOption({
    name: 'answer', description: 'Expected answer (question mode; never stored in plaintext)',
    required: false,
  })
  answer?: string;
}

class OverrideOptions {
  @UserOption({
    name: 'member', description: 'Current guild member to release manually',
    required: true,
  })
  member: User;
}

interface ManagerContext {
  guild: Guild;
  staff: GuildMember;
  bot: GuildMember;
}

@VerificationGroup()
@Injectable()
export class VerificationCommands {
  private readonly logger = new Logger(VerificationCommands.name);

  constructor(
    private readonly verification: VerificationService,
    private readonly memberLocks: RolePanelService,
    private readonly config: ConfigService,
  ) {}

  private async manager(
    interaction: ChatInputCommandInteraction,
  ): Promise<ManagerContext | null> {
    const guild = interaction.guild;
    if (!guild || !interaction.guildId) return null;
    const [staff, bot] = await Promise.all([
      guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null),
      guild.members.fetchMe().catch(() => null),
    ]);
    if (!staff || !bot ||
        !staff.permissions.has(PermissionFlagsBits.ManageGuild) ||
        !staff.permissions.has(PermissionFlagsBits.ManageRoles)) return null;
    return { guild, staff, bot };
  }

  private staffAbove(staff: ManagerContext, role: Role): boolean {
    return staff.staff.id === staff.guild.ownerId ||
      staff.staff.roles.highest.comparePositionTo(role) > 0;
  }

  @Subcommand({ name: 'setup', description: 'Create a disabled verification draft' })
  async onSetup(
    @Context() [interaction]: SlashCommandContext,
    @Options() { channel, quarantineRole, mode, question, answer }: SetupOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ctx = await this.manager(interaction);
    if (!ctx) return interaction.editReply('Manage Server and Manage Roles are required.');
    if (this.config.get<string>('ENABLE_GUILD_MEMBERS_INTENT') !== 'true') {
      return interaction.editReply('Enable the Guild Members intent in the bot and Discord Developer Portal first.');
    }
    if ((mode !== 'button' && mode !== 'question') ||
        (mode === 'button' && (question || answer)) ||
        !quarantineRole || !channel ||
        quarantineRole.guild.id !== ctx.guild.id ||
        channel.guildId !== ctx.guild.id) {
      return interaction.editReply('Choose a valid guild role/channel and mode; answers are for question mode only.');
    }
    const check = await inspectVerificationEnvironment(
      ctx.guild, ctx.bot, channel.id, quarantineRole.id,
    );
    if (check.denial || !check.value || !this.staffAbove(ctx, check.value.role)) {
      return interaction.editReply(check.denial ||
        'Staff role must outrank the quarantine role.');
    }
    try {
      const stored = await this.verification.setup(
        ctx.guild.id, channel.id, quarantineRole.id,
        interaction.user.id, mode as VerificationMode, question, answer,
      );
      return interaction.editReply({
        content: 'Verification draft #' + stored.revision +
          ' saved (disabled). Run /verify publish to activate it for NEW joins only.',
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.logger.warn('Verification setup rejected (no role changes)', error);
      return interaction.editReply('Setup rejected. Disable an older panel or check question, configuration and DB.');
    }
  }

  @Subcommand({ name: 'publish', description: 'Publish the verification button safely' })
  async onPublish(@Context() [interaction]: SlashCommandContext) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ctx = await this.manager(interaction);
    if (!ctx) return interaction.editReply('Manage Server and Manage Roles are required.');
    if (this.config.get<string>('ENABLE_GUILD_MEMBERS_INTENT') !== 'true') {
      return interaction.editReply('The Guild Members intent is required to quarantine new joins.');
    }
    const draft = await this.verification.getConfig(ctx.guild.id).catch(() => null);
    if (!draft || draft.status !== 'draft') {
      return interaction.editReply('There is no unpublished verification draft.');
    }
    const check = await inspectVerificationEnvironment(
      ctx.guild, ctx.bot, draft.channelId, draft.quarantineRoleId,
    );
    if (check.denial || !check.value || !this.staffAbove(ctx, check.value.role)) {
      return interaction.editReply(check.denial || 'Staff cannot manage this quarantine role.');
    }
    const customId = buttonId(ctx.guild.id, draft.revision);
    if (!customId) return interaction.editReply('Invalid verification component version.');
    try {
      const reserved = await this.verification.beginPublish(ctx.guild.id);
      const button = new ButtonBuilder().setCustomId(customId)
        .setLabel(reserved.mode === 'question' ? 'Answer verification question' : 'Verify membership')
        .setStyle(ButtonStyle.Primary);
      const message = await check.value.channel.send({
        content: 'Member verification: press the button below. ' +
          'Only members of this server can complete it. ' +
          'Verification never grants privileged roles.',
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
        allowedMentions: { parse: [] },
      });
      const active = await this.verification.activate(
        ctx.guild.id, reserved.revision, message.id,
      );
      if (!active) {
        await message.edit({ components: [] }).catch(() => null);
        return interaction.editReply('Panel was disabled during publication. No active verification was created.');
      }
      return interaction.editReply({
        content: 'Verification activated in <#' + draft.channelId +
          '>. New members will receive the quarantine role until they verify.',
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.logger.warn('Verification publish outcome uncertain; no retry', error);
      return interaction.editReply(
        'Publish outcome unknown. Inspect the channel; disable the draft before recreating it. No automatic retry.',
      );
    }
  }

  @Subcommand({ name: 'disable', description: 'Stop verification and new quarantine actions' })
  async onDisable(@Context() [interaction]: SlashCommandContext) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ctx = await this.manager(interaction);
    if (!ctx) return interaction.editReply('Manage Server and Manage Roles are required.');
    try {
      const disabled = await this.verification.disable(ctx.guild.id);
      if (!disabled) return interaction.editReply('No configuration exists or status changed concurrently.');
      if (disabled.messageId) {
        const channel = await ctx.guild.channels.fetch(disabled.channelId).catch(() => null);
        if (channel?.type === ChannelType.GuildText) {
          const message = await channel.messages.fetch(disabled.messageId).catch(() => null);
          await message?.edit({ components: [] }).catch(() => null);
        }
      }
      return interaction.editReply(
        'Verification disabled. Existing quarantine roles are unchanged; use /verify override for manual release.',
      );
    } catch (error) {
      this.logger.warn('Verification disable failed', error);
      return interaction.editReply('Database disable could not be confirmed.');
    }
  }

  @Subcommand({ name: 'status', description: 'Review verification status and recent metadata-only events' })
  async onStatus(@Context() [interaction]: SlashCommandContext) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ctx = await this.manager(interaction);
    if (!ctx) return interaction.editReply('Manage Server and Manage Roles are required.');
    try {
      const [stored, recent] = await Promise.all([
        this.verification.getConfig(ctx.guild.id),
        this.verification.recentActions(ctx.guild.id),
      ]);
      if (!stored) return interaction.editReply('No verification flow is configured.');
      return interaction.editReply({
        content: (
          'Verification: ' + stored.status + ' (revision ' + stored.revision + ')' +
          '\nMode: ' + stored.mode + ' | Channel: ' + stored.channelId +
          ' | Quarantine role: ' + stored.quarantineRoleId +
          '\nRecent metadata-only events: ' +
          (recent.length
            ? recent.map(a => a.action + '/' + a.status + ' ' + a.userId).join(', ').slice(0, 900)
            : 'none') +
          '\nQuestion answers and moderation text are never shown.'
        ),
        allowedMentions: { parse: [] },
      });
    } catch {
      return interaction.editReply('Could not load verification status.');
    }
  }

  @Subcommand({ name: 'override', description: 'Staff-only release or exemption for one member' })
  async onOverride(
    @Context() [interaction]: SlashCommandContext,
    @Options() { member: target }: OverrideOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ctx = await this.manager(interaction);
    if (!ctx) return interaction.editReply('Manage Server and Manage Roles are required.');
    let lease: { token: string; coolingDown: boolean } | null = null;
    let attempted = false;
    let actionId: number | null = null;
    let claim: { token: string; roleId: string } | null = null;
    let claimedSessionKey: string | null = null;
    let outcome: 'succeeded' | 'denied' | 'failed' | 'uncertain' = 'uncertain';
    let release: 'released' | 'quarantined' | 'release_uncertain' = 'quarantined';
    try {
      const member = await ctx.guild.members.fetch({
        user: target.id, force: true,
      }).catch(() => null);
      const config = await this.verification.getConfig(ctx.guild.id);
      if (!member || member.user.bot || !member.joinedTimestamp || !config) {
        return interaction.editReply('Member, current join session or verification config unavailable.');
      }
      const sessionKey = String(member.joinedTimestamp);
      if (!validJoinSession(sessionKey)) {
        return interaction.editReply('Invalid member join timestamp; no role was changed.');
      }
      lease = await this.memberLocks.acquireMember(ctx.guild.id, member.id);
      if (!lease || lease.coolingDown) {
        return interaction.editReply('Another member role operation is in progress or cooling down.');
      }
      const existing = await this.verification.getSession(ctx.guild.id, member.id);
      const roleId = existing?.sessionKey === sessionKey
        ? existing.quarantineRoleId : config.quarantineRoleId;
      const role = await ctx.guild.roles.fetch(roleId, { force: true }).catch(() => null);
      if (role && !this.staffAbove(ctx, role)) {
        return interaction.editReply('Your highest role must outrank the quarantine role.');
      }
      await this.verification.prepareOverride(ctx.guild.id, member.id, sessionKey, roleId);
      const sameSession = await this.verification.getSession(ctx.guild.id, member.id);
      if (!sameSession || sameSession.sessionKey !== sessionKey) {
        return interaction.editReply('The membership session changed; no override was attempted.');
      }
      actionId = await this.verification.beginAction(
        ctx.guild.id, interaction.id, member.id, interaction.user.id,
        sessionKey, 'override',
      );
      if (!actionId) return interaction.editReply('This override interaction was already recorded.');
      claim = await this.verification.claimRelease(
        ctx.guild.id, member.id, sessionKey, true,
      );
      if (claim) claimedSessionKey = sessionKey;
      if (!claim) {
        outcome = 'denied';
        return interaction.editReply('No unresolved current verification session to override.');
      }
      const fresh = await ctx.guild.members.fetch({
        user: member.id, force: true,
      }).catch(() => null);
      if (!fresh || String(fresh.joinedTimestamp) !== sessionKey ||
          !await this.memberLocks.hasMemberLease(ctx.guild.id, member.id, lease.token)) {
        outcome = 'denied';
        return interaction.editReply('Membership changed or lock expired; override denied.');
      }
      if (fresh.roles.cache.has(claim.roleId)) {
        if (!await canSafelyRemoveQuarantineRole(ctx.guild, ctx.bot, claim.roleId)) {
          outcome = 'denied';
          return interaction.editReply('Bot cannot safely remove the quarantine role. Fix hierarchy first.');
        }
        attempted = true;
        try {
          await fresh.roles.remove(claim.roleId, 'Yuugen staff verification override');
        } catch {
          release = 'release_uncertain';
          return interaction.editReply('Discord removal response is uncertain. Inspect member roles before retry.');
        }
      }
      const confirmed = await ctx.guild.members.fetch({
        user: member.id, force: true,
      }).catch(() => null);
      if (!confirmed || String(confirmed.joinedTimestamp) !== sessionKey ||
          confirmed.roles.cache.has(claim.roleId)) {
        release = 'release_uncertain';
        return interaction.editReply('Override outcome unverified. Staff review required.');
      }
      release = 'released';
      outcome = 'succeeded';
      return interaction.editReply(
        'Staff override recorded. Only the quarantine role was removed, if present.',
      );
    } catch (error) {
      this.logger.warn('Manual verification override uncertain', error);
      if (attempted) release = 'release_uncertain';
      return interaction.editReply('Override could not be verified; inspect session and roles.');
    } finally {
      if (claim && claimedSessionKey) {
        await this.verification.finishRelease(
          ctx.guild.id, target.id, claimedSessionKey, claim.token, release,
        ).catch(error => this.logger.error('Cannot finalize override session', error));
      }
      if (actionId) {
        await this.verification.finishAction(ctx.guild.id, actionId, outcome)
          .catch(error => this.logger.error('Cannot finalize override audit', error));
      }
      if (lease) {
        await this.memberLocks.releaseMember(
          ctx.guild.id, target.id, lease.token, attempted,
        ).catch(error => this.logger.error('Cannot release override lease', error));
      }
    }
  }
}
