import { Injectable, Logger } from '@nestjs/common';
import {
  Button,
  Context,
  IntegerOption,
  Options,
  StringOption,
  Subcommand,
  UserOption,
  createCommandGroupDecorator,
} from 'necord';
import type { ButtonContext, SlashCommandContext } from 'necord';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  User,
  escapeMarkdown,
} from 'discord.js';
import { ModerationService } from '../../../domain/moderation/moderation.service';
import { getWarningDenial } from './warning-policy';
import { getKickDenial } from './kick-policy';
import { getBanDenial } from './ban-policy';

const ModerationGroup = createCommandGroupDecorator({
  name: 'mod',
  description: 'Server moderation and case history',
});

class WarnOptions {
  @UserOption({
    name: 'user',
    description: 'Current guild member to warn',
    required: true,
  })
  user: User;

  @StringOption({
    name: 'reason',
    description: 'Reason shown in the moderation history (max 512 characters)',
    required: true,
  })
  reason: string;
}

class KickOptions {
  @UserOption({
    name: 'user',
    description: 'Server member to remove',
    required: true,
  })
  user: User;

  @StringOption({
    name: 'reason',
    description: 'Kick reason (1-512 characters)',
    required: true,
  })
  reason: string;
}

class BanOptions {
  @UserOption({
    name: 'user',
    description: 'Current server member to ban permanently',
    required: true,
  })
  user: User;

  @StringOption({
    name: 'reason',
    description: 'Permanent ban reason (1-512 characters)',
    required: true,
  })
  reason: string;
}

class WarningHistoryOptions {
  @UserOption({
    name: 'user',
    description: 'User whose moderation warnings you want to view',
    required: true,
  })
  user: User;
}

class CaseHistoryOptions {
  @UserOption({
    name: 'user',
    description: 'User to look up (may still be a current member)',
    required: false,
  })
  user?: User;

  @StringOption({
    name: 'user_id',
    description: 'Discord user ID for a member who has already left',
    required: false,
  })
  userId?: string;
}

class UnwarnOptions {
  @IntegerOption({
    name: 'id',
    description: 'Warning case number to revoke',
    required: true,
  })
  id: number;

  @StringOption({
    name: 'reason',
    description: 'Optional reason for removing this warning',
    required: false,
  })
  reason?: string;
}

interface StaffContext {
  guild: Guild;
  moderator: GuildMember;
}

interface PendingKick {
  guildId: string;
  actorId: string;
  targetId: string;
  reason: string;
  expiresAt: number;
}

interface PendingBan {
  guildId: string;
  actorId: string;
  targetId: string;
  reason: string;
  expiresAt: number;
}

@ModerationGroup()
@Injectable()
export class ModerationCommands {
  private readonly logger = new Logger(ModerationCommands.name);
  private readonly pendingKicks = new Map<string, PendingKick>();
  private readonly pendingBans = new Map<string, PendingBan>();

  constructor(private readonly moderation: ModerationService) {}

  private async staffContext(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    requiredPermission: bigint | bigint[] = PermissionFlagsBits.ModerateMembers,
  ): Promise<StaffContext | null> {
    const guild = interaction.guild;
    if (!guild || !interaction.guildId) return null;

    const moderator = await guild.members
      .fetch({ user: interaction.user.id, force: true })
      .catch(() => null);
    const permissions = typeof requiredPermission === 'bigint'
      ? [requiredPermission]
      : requiredPermission;
    if (!moderator || !permissions.some((value) => moderator.permissions.has(value))) {
      return null;
    }
    return { guild, moderator };
  }

  @Subcommand({
    name: 'warn',
    description: 'Record a warning against a guild member',
  })
  public async onWarn(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, reason }: WarnOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const staff = await this.staffContext(interaction);
    if (!staff) {
      return interaction.editReply('This command requires a server moderator with Moderate Members permission.');
    }
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 512) {
      return interaction.editReply('Give a reason between 1 and 512 characters.');
    }

    const member = await staff.guild.members
      .fetch({ user: user.id, force: true })
      .catch(() => null);

    const denial = getWarningDenial({
      actorUserId: interaction.user.id,
      targetUserId: user.id,
      guildOwnerId: staff.guild.ownerId,
      actorHasModerateMembers: true,
      targetIsBot: user.bot,
      targetIsGuildMember: !!member,
      actorRoleAboveTarget: !!member &&
        staff.moderator.roles.highest.comparePositionTo(member.roles.highest) > 0,
    });
    if (denial) return interaction.editReply(denial);

    try {
      const saved = await this.moderation.warn(
        staff.guild.id,
        user.id,
        interaction.user.id,
        reason,
      );
      return interaction.editReply({
        content: 'Warning #' + saved.id + ' recorded for <@' + user.id +
          '>. Use /mod warnings to review or /mod unwarn to revoke it.',
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.logger.error('Failed to record moderation warning', error);
      return interaction.editReply('Could not save that warning. Ask an administrator to check the database.');
    }
  }

  /** Re-check permissions and target status on confirmation, not only preview. */
  private async kickEligibility(
    staff: StaffContext,
    actorId: string,
    targetId: string,
  ): Promise<{ member: GuildMember | null; denial: string | null }> {
    const [member, botMember] = await Promise.all([
      staff.guild.members
        .fetch({ user: targetId, force: true })
        .catch(() => null),
      staff.guild.members.fetchMe().catch(() => null),
    ]);

    const denial = getKickDenial({
      actorId,
      targetId,
      guildOwnerId: staff.guild.ownerId,
      actorHasKickMembers: staff.moderator.permissions.has(
        PermissionFlagsBits.KickMembers,
      ),
      targetIsMember: !!member,
      targetIsBot: !!member?.user.bot,
      actorRoleAboveTarget: !!member &&
        staff.moderator.roles.highest.comparePositionTo(member.roles.highest) > 0,
      botHasKickMembers: !!botMember?.permissions.has(
        PermissionFlagsBits.KickMembers,
      ),
      targetKickable: member?.kickable === true,
    });
    return { member, denial };
  }

  private cleanupPendingKicks(): void {
    const now = Date.now();
    for (const [messageId, pending] of this.pendingKicks) {
      if (pending.expiresAt <= now) this.pendingKicks.delete(messageId);
    }
  }

  @Subcommand({
    name: 'kick',
    description: 'Request confirmation before kicking a member',
  })
  public async onKick(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, reason }: KickOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const staff = await this.staffContext(
      interaction,
      PermissionFlagsBits.KickMembers,
    );
    if (!staff) {
      return interaction.editReply('You need the Kick Members permission in this server.');
    }

    const cleanedReason = typeof reason === 'string'
      ? reason.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
      : '';
    if (!cleanedReason || cleanedReason.length > 512) {
      return interaction.editReply('Give a kick reason between 1 and 512 characters.');
    }

    const { denial } = await this.kickEligibility(
      staff, interaction.user.id, user.id,
    );
    if (denial) return interaction.editReply(denial);

    this.cleanupPendingKicks();
    if (this.pendingKicks.size >= 100) {
      return interaction.editReply(
        'Too many pending kick confirmations. Try again shortly.',
      );
    }

    const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('mod-kick-confirm')
        .setLabel('Confirm kick')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('mod-kick-cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    const message = await interaction.editReply({
      content: '**Confirm kick of <@' + user.id + '>**\nReason: ' +
        escapeMarkdown(cleanedReason) +
        '\nOnly you can confirm. This request expires in 60 seconds.',
      components: [controls],
      allowedMentions: { parse: [] },
    });
    this.pendingKicks.set(message.id, {
      guildId: staff.guild.id,
      actorId: interaction.user.id,
      targetId: user.id,
      reason: cleanedReason,
      expiresAt: Date.now() + 60_000,
    });
  }

  @Button('mod-kick-cancel')
  public async onKickCancel(@Context() [interaction]: ButtonContext) {
    const pending = this.pendingKicks.get(interaction.message.id);
    if (!pending || pending.actorId !== interaction.user.id ||
        pending.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'This kick confirmation is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }
    this.pendingKicks.delete(interaction.message.id);
    return interaction.update({
      content: 'Kick canceled. No member was removed.',
      components: [],
    });
  }

  @Button('mod-kick-confirm')
  public async onKickConfirm(@Context() [interaction]: ButtonContext) {
    const pending = this.pendingKicks.get(interaction.message.id);
    if (!pending || pending.actorId !== interaction.user.id ||
        pending.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'This kick confirmation is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Consume immediately so double clicks cannot cause duplicate actions.
    this.pendingKicks.delete(interaction.message.id);
    await interaction.deferUpdate();

    if (pending.expiresAt <= Date.now()) {
      return interaction.editReply({
        content: 'Kick confirmation expired. Use /mod kick again.',
        components: [],
      });
    }
    const staff = await this.staffContext(
      interaction, PermissionFlagsBits.KickMembers,
    );
    if (!staff || staff.guild.id !== pending.guildId) {
      return interaction.editReply({
        content: 'Kick canceled: you no longer have Kick Members permission.',
        components: [],
      });
    }

    const { member, denial } = await this.kickEligibility(
      staff, interaction.user.id, pending.targetId,
    );
    if (denial || !member) {
      return interaction.editReply({
        content: 'Kick canceled: ' + (denial || 'Target is unavailable.'),
        components: [],
      });
    }

    let record: Awaited<ReturnType<ModerationService['beginKick']>>;
    try {
      // Never initiate a Discord kick unless an audit attempt was persisted.
      record = await this.moderation.beginKick(
        pending.guildId, pending.targetId, pending.actorId, pending.reason,
      );
    } catch (error) {
      this.logger.error('Kick audit creation failed; Discord action skipped', error);
      return interaction.editReply({
        content: 'No kick attempted: Yuugen could not save the moderation case.',
        components: [],
      });
    }

    try {
      const auditReason = (
        'Yuugen case #' + record.id + ', moderator ' +
        pending.actorId + ': ' + pending.reason
      ).slice(0, 512);
      await member.kick(auditReason);
    } catch (error) {
      // A transport timeout does not prove the action failed. Only a clear
      // Discord 403/404 response can be logged as a definitive failure;
      // otherwise retain kick_pending for manual membership verification.
      const status = error && typeof error === 'object' && 'status' in error
        ? (error as { status?: unknown }).status : null;
      const definitiveFailure = status === 403 || status === 404;
      this.logger.warn(
        'Discord kick response for case #' + record.id +
          (definitiveFailure ? ' was rejected' : ' was inconclusive'),
      );

      let recordedFailure = false;
      if (definitiveFailure) {
        try {
          recordedFailure = !!await this.moderation.finalizeKick(
            pending.guildId, record.id, 'kick_failed',
          );
        } catch (saveError) {
          this.logger.error(
            'Could not finalize failed kick case #' + record.id, saveError,
          );
        }
      }
      return interaction.editReply({
        content: recordedFailure
          ? 'Discord rejected the kick. Case #' + record.id + ' is marked failed.'
          : 'The kick outcome is unconfirmed. Case #' + record.id +
            ' remains pending. Check guild membership before retrying.',
        components: [],
      });
    }

    let finalized = false;
    try {
      finalized = !!await this.moderation.finalizeKick(
        pending.guildId, record.id, 'kick',
      );
    } catch (error) {
      this.logger.error('Kick succeeded but audit finalization failed', error);
    }
    if (!finalized) {
      this.logger.warn('Kick case #' + record.id + ' needs manual reconciliation');
      return interaction.editReply({
        content: 'The member was kicked, but case #' + record.id +
          ' is still pending in the audit log. Staff must reconcile it.',
        components: [],
      });
    }
    return interaction.editReply({
      content: 'Kicked <@' + pending.targetId + '> from this server. ' +
        'Case #' + record.id + ' has been recorded.',
      components: [],
      allowedMentions: { parse: [] },
    });
  }


  /** Fetch the latest target/member/bot state for the planned ban. */
  private async banEligibility(
    staff: StaffContext,
    actorId: string,
    targetId: string,
  ): Promise<{ member: GuildMember | null; denial: string | null }> {
    const [member, botMember] = await Promise.all([
      staff.guild.members.fetch({ user: targetId, force: true })
        .catch(() => null),
      staff.guild.members.fetchMe().catch(() => null),
    ]);
    const denial = getBanDenial({
      actorId,
      targetId,
      guildOwnerId: staff.guild.ownerId,
      actorHasBanMembers: staff.moderator.permissions.has(
        PermissionFlagsBits.BanMembers,
      ),
      targetIsMember: !!member,
      targetIsBot: member?.user.bot === true,
      actorRoleAboveTarget: !!member &&
        staff.moderator.roles.highest.comparePositionTo(member.roles.highest) > 0,
      botHasBanMembers: !!botMember?.permissions.has(
        PermissionFlagsBits.BanMembers,
      ),
      targetBannable: member?.bannable === true,
    });
    return { member, denial };
  }

  private cleanupPendingBans(): void {
    const now = Date.now();
    for (const [messageId, pending] of this.pendingBans) {
      if (pending.expiresAt <= now) this.pendingBans.delete(messageId);
    }
  }

  @Subcommand({
    name: 'ban',
    description: 'Permanently ban a member after confirmation',
  })
  public async onBan(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, reason }: BanOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const staff = await this.staffContext(
      interaction, PermissionFlagsBits.BanMembers,
    );
    if (!staff) {
      return interaction.editReply('You need the Ban Members permission in this server.');
    }
    const cleanedReason = typeof reason === 'string'
      ? reason.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
      : '';
    if (cleanedReason.length < 1 || cleanedReason.length > 512) {
      return interaction.editReply('Give a ban reason between 1 and 512 characters.');
    }
    const { denial } = await this.banEligibility(
      staff, interaction.user.id, user.id,
    );
    if (denial) return interaction.editReply(denial);

    this.cleanupPendingBans();
    if (this.pendingBans.size >= 100) {
      return interaction.editReply(
        'Too many outstanding ban confirmations. Try again shortly.',
      );
    }
    const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('mod-ban-confirm')
        .setLabel('Confirm permanent ban')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('mod-ban-cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );
    const message = await interaction.editReply({
      content: '**Confirm permanent ban of <@' + user.id + '>**\nReason: ' +
        escapeMarkdown(cleanedReason) +
        '\nThis blocks rejoining until a moderator unbans them. ' +
        'Only you can confirm. Expires in 60 seconds. ' +
        'No prior messages will be deleted.',
      components: [controls],
      allowedMentions: { parse: [] },
    });
    this.pendingBans.set(message.id, {
      guildId: staff.guild.id,
      actorId: interaction.user.id,
      targetId: user.id,
      reason: cleanedReason,
      expiresAt: Date.now() + 60_000,
    });
  }

  @Button('mod-ban-cancel')
  public async onBanCancel(@Context() [interaction]: ButtonContext) {
    const pending = this.pendingBans.get(interaction.message.id);
    if (!pending || pending.actorId !== interaction.user.id ||
        pending.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'This ban confirmation is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }
    this.pendingBans.delete(interaction.message.id);
    return interaction.update({
      content: 'Ban canceled. No member was banned.',
      components: [],
    });
  }

  @Button('mod-ban-confirm')
  public async onBanConfirm(@Context() [interaction]: ButtonContext) {
    const pending = this.pendingBans.get(interaction.message.id);
    if (!pending || pending.actorId !== interaction.user.id ||
        pending.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'This ban confirmation is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Consume synchronously, before the first await. Concurrent clicks
    // against the same confirmation can execute only one ban.
    this.pendingBans.delete(interaction.message.id);
    await interaction.deferUpdate();
    if (pending.expiresAt <= Date.now()) {
      return interaction.editReply({
        content: 'Ban confirmation expired. Use /mod ban again.',
        components: [],
      });
    }

    const staff = await this.staffContext(
      interaction, PermissionFlagsBits.BanMembers,
    );
    if (!staff || staff.guild.id !== pending.guildId) {
      return interaction.editReply({
        content: 'Ban canceled: you no longer have Ban Members permission.',
        components: [],
      });
    }
    const { member, denial } = await this.banEligibility(
      staff, interaction.user.id, pending.targetId,
    );
    if (denial || !member) {
      return interaction.editReply({
        content: 'Ban canceled: ' + (denial || 'Target is unavailable.'),
        components: [],
      });
    }

    let record: Awaited<ReturnType<ModerationService['beginBan']>>;
    try {
      record = await this.moderation.beginBan(
        pending.guildId, pending.targetId, pending.actorId, pending.reason,
      );
    } catch (error) {
      this.logger.error('Ban case write failed; Discord ban was not attempted', error);
      return interaction.editReply({
        content: 'No ban attempted: Yuugen could not save the audit case.',
        components: [],
      });
    }

    try {
      const auditReason = (
        'Yuugen case #' + record.id + ', moderator ' +
        pending.actorId + ': ' + pending.reason
      ).slice(0, 512);
      // Explicit zero avoids deleting earlier messages during a ban.
      await member.ban({ deleteMessageSeconds: 0, reason: auditReason });
    } catch (error) {
      // A timeout or connection reset may mean Discord completed the ban.
      // Only explicit 403/404 errors are treated as definitive failures.
      const status = error && typeof error === 'object' && 'status' in error
        ? (error as { status?: unknown }).status : null;
      const definitiveFailure = status === 403 || status === 404;
      let markedFailed = false;
      if (definitiveFailure) {
        try {
          markedFailed = !!await this.moderation.finalizeBan(
            pending.guildId, record.id, 'ban_failed',
          );
        } catch (saveError) {
          this.logger.error('Ban failure case finalization failed', saveError);
        }
      }
      this.logger.warn(
        'Discord ban case #' + record.id +
        (definitiveFailure ? ' rejected' : ' has uncertain outcome'),
      );
      return interaction.editReply({
        content: markedFailed
          ? 'Discord rejected the ban. Case #' + record.id + ' is marked failed.'
          : 'Ban outcome is unconfirmed. Case #' + record.id +
            ' remains pending. Check the Discord guild ban list before retrying.',
        components: [],
      });
    }

    let finalized = false;
    try {
      finalized = !!await this.moderation.finalizeBan(
        pending.guildId, record.id, 'ban',
      );
    } catch (error) {
      this.logger.error('Ban succeeded; audit finalization failed', error);
    }
    if (!finalized) {
      return interaction.editReply({
        content: 'The member was banned, but case #' + record.id +
          ' remains pending. Staff must reconcile the case.',
        components: [],
      });
    }
    return interaction.editReply({
      content: 'Permanently banned <@' + pending.targetId +
        '> from this server. Case #' + record.id + ' recorded.',
      components: [],
      allowedMentions: { parse: [] },
    });
  }

  @Subcommand({
    name: 'cases',
    description: 'Show warnings, kicks and bans for a user',
  })
  public async onCases(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, userId }: CaseHistoryOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const staff = await this.staffContext(interaction, [
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
    ]);
    if (!staff) {
      return interaction.editReply(
        'You need Moderate Members, Kick Members, or Ban Members permission.',
      );
    }
    const targetId = user?.id || userId?.trim();
    if (!targetId || !/^\d{17,20}$/.test(targetId)) {
      return interaction.editReply(
        'Select a user or provide their 17-20 digit Discord user ID.',
      );
    }
    try {
      const history = await this.moderation.casesForUser(
        staff.guild.id, targetId,
      );
      if (history.length === 0) {
        return interaction.editReply('No moderation cases for this user in this server.');
      }
      const entries = history.map((item) => {
        const timestamp = Math.floor(new Date(item.createdAt).getTime() / 1000);
        const when = Number.isFinite(timestamp)
          ? '<t:' + timestamp + ':f>'
          : 'unknown date';
        const state = item.action === 'warn' && item.revokedAt
          ? 'warn (revoked)' : item.action.replace(/_/g, ' ');
        const detail = item.reason.length > 150
          ? item.reason.slice(0, 147) + '...'
          : item.reason;
        return '#' + item.id + ' ' + state + ' · ' + when +
          ' · <@' + item.moderatorUserId + '>\n' + escapeMarkdown(detail);
      });
      return interaction.editReply({
        content: ('**Cases for <@' + targetId + '>**\n\n' +
          entries.join('\n\n')).slice(0, 1950),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.logger.error('Failed to list moderation cases', error);
      return interaction.editReply('Could not retrieve moderation cases.');
    }
  }

  @Subcommand({
    name: 'warnings',
    description: 'Show the last 10 warnings for a user in this server',
  })
  public async onWarnings(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user }: WarningHistoryOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const staff = await this.staffContext(interaction);
    if (!staff) {
      return interaction.editReply('This command requires a server moderator with Moderate Members permission.');
    }

    try {
      const history = await this.moderation.warnings(staff.guild.id, user.id);
      if (history.length === 0) {
        return interaction.editReply('There are no recorded warnings for that user in this server.');
      }
      const entries = history.map((item) => {
        const created = Math.floor(new Date(item.createdAt).getTime() / 1000);
        const date = Number.isFinite(created) ? '<t:' + created + ':f>' : 'unknown date';
        const state = item.revokedAt ? 'revoked' : 'active';
        const reason = item.reason.length > 120
          ? item.reason.slice(0, 117) + '...'
          : item.reason;
        const removal = item.revokedAt
          ? '\nRevoked by <@' + (item.revokedByUserId || 'unknown') +
            '>: ' + (item.revocationReason || 'No reason given').slice(0, 80)
          : '';
        return '#' + item.id + ' (' + state + ') · ' + date +
          ' · by <@' + item.moderatorUserId + '>\n' + reason + removal;
      });

      return interaction.editReply({
        content: ('**Warnings for <@' + user.id + '>**\n\n' + entries.join('\n\n'))
          .slice(0, 1950),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.logger.error('Failed to fetch moderation warnings', error);
      return interaction.editReply('Could not load warning history right now.');
    }
  }

  @Subcommand({
    name: 'unwarn',
    description: 'Revoke an active warning by its case number',
  })
  public async onUnwarn(
    @Context() [interaction]: SlashCommandContext,
    @Options() { id, reason }: UnwarnOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const staff = await this.staffContext(interaction);
    if (!staff) {
      return interaction.editReply('This command requires a server moderator with Moderate Members permission.');
    }

    try {
      const revoked = await this.moderation.unwarn(
        staff.guild.id,
        id,
        interaction.user.id,
        reason && reason.trim() ? reason : 'Removed by moderator',
      );
      return interaction.editReply(revoked
        ? 'Warning #' + id + ' has been revoked. Its audit history is retained.'
        : 'No active warning with that case number exists in this server.');
    } catch (error) {
      this.logger.error('Failed to revoke moderation warning', error);
      return interaction.editReply('Could not revoke that warning. Check the case number and reason.');
    }
  }
}
