import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  Button,
  ChannelOption,
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
  ChannelType,
  Guild,
  GuildChannel,
  GuildMember,
  Message,
  MessageFlags,
  NewsChannel,
  PermissionFlagsBits,
  TextChannel,
  User,
  escapeMarkdown,
} from 'discord.js';
import { ModerationService } from '../../../domain/moderation/moderation.service';
import { ModerationPurgeService } from '../../../domain/moderation/moderation-purge.service';
import { ModerationChannelLockService } from '../../../domain/moderation/moderation-channel-lock.service';
import type { ModerationChannelLock } from '../../../domain/moderation/moderation-channel-lock.entity';
import { getWarningDenial } from './warning-policy';
import {
  getChannelLockDenial,
  getChannelLockReason,
  makeLockSnapshot,
  matchesLockedSnapshot,
  originalSendOverride,
  readSendState,
  type LockSnapshot,
  type OverwriteSnapshot,
} from './channel-lock-policy';
import {
  buildPurgePlan,
  DISCORD_SNOWFLAKE,
  getPurgeDenial,
  samePurgeSelection,
  validatePurgeCount,
  type PurgePlan,
} from './purge-policy';
import { getKickDenial } from './kick-policy';
import { getBanDenial } from './ban-policy';
import { getUnbanDenial, isUnknownBanError } from './unban-policy';
import {
  formatTimeoutDuration,
  getTimeoutDenial,
  isDefinitiveTimeoutRejection,
  parseTimeoutDuration,
  type TimeoutAction,
} from './timeout-policy';

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

class UnbanOptions {
  @StringOption({
    name: 'user_id',
    description: 'Discord user ID to unban (17-20 digits)',
    required: true,
  })
  userId: string;

  @StringOption({
    name: 'reason',
    description: 'Reason for unbanning (1-512 characters)',
    required: true,
  })
  reason: string;
}

class TimeoutOptions {
  @UserOption({
    name: 'user',
    description: 'Current guild member to temporarily time out',
    required: true,
  })
  user: User;

  @StringOption({
    name: 'duration',
    description: 'Duration from 1m to 28d, such as 10m, 2h or 7d',
    required: true,
  })
  duration: string;

  @StringOption({
    name: 'reason',
    description: 'Reason for the timeout (1-512 characters)',
    required: true,
  })
  reason: string;
}

class UntimeoutOptions {
  @UserOption({
    name: 'user',
    description: 'Current guild member whose timeout should be removed',
    required: true,
  })
  user: User;

  @StringOption({
    name: 'reason',
    description: 'Reason for removing the timeout (1-512 characters)',
    required: true,
  })
  reason: string;
}

class PurgeOptions {
  @IntegerOption({
    name: 'count',
    description: 'Number of eligible messages to delete (1-100)',
    required: true,
    minValue: 1,
    maxValue: 100,
  })
  count: number;

  @StringOption({
    name: 'reason',
    description: 'Required audit reason (1-512 characters)',
    required: true,
  })
  reason: string;

  @UserOption({
    name: 'user',
    description: 'Optional author filter',
    required: false,
  })
  user?: User;

  @StringOption({
    name: 'user_id',
    description: 'Optional author ID for members who left the server',
    required: false,
  })
  userId?: string;

  @ChannelOption({
    name: 'channel',
    description: 'Text channel to purge (defaults to current channel)',
    required: false,
    channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
  })
  channel?: GuildChannel;
}

class ChannelLockOptions {
  @StringOption({
    name: 'reason',
    description: 'Why posting is being locked (1-512 characters)',
    required: true,
  })
  reason: string;

  @ChannelOption({
    name: 'channel',
    description: 'Text channel to lock (defaults to the current channel)',
    required: false,
    channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
  })
  channel?: GuildChannel;
}

class ChannelUnlockOptions {
  @StringOption({
    name: 'reason',
    description: 'Why posting is being unlocked (1-512 characters)',
    required: true,
  })
  reason: string;

  @ChannelOption({
    name: 'channel',
    description: 'Previously locked text channel (defaults to current)',
    required: false,
    channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
  })
  channel?: GuildChannel;
}

class ChannelLockStatusOptions {
  @ChannelOption({
    name: 'channel',
    description: 'Channel to inspect (defaults to current)',
    required: false,
    channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
  })
  channel?: GuildChannel;
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

interface PendingUnban {
  guildId: string;
  actorId: string;
  targetId: string;
  reason: string;
  expiresAt: number;
}

interface PendingTimedAction {
  guildId: string;
  actorId: string;
  targetId: string;
  reason: string;
  action: TimeoutAction;
  durationMs?: number;
  confirmationExpiresAt: number;
}

interface PendingPurge {
  guildId: string;
  actorId: string;
  channelId: string;
  filterUserId: string | null;
  reason: string;
  requestedCount: number;
  messageIds: string[];
  expiresAt: number;
}

type ChannelLockAction = 'lock' | 'unlock';

interface PendingChannelLock {
  action: ChannelLockAction;
  guildId: string;
  channelId: string;
  actorId: string;
  reason: string;
  snapshot?: LockSnapshot;
  lockId?: number;
  expiresAt: number;
}

@ModerationGroup()
@Injectable()
export class ModerationCommands {
  private readonly logger = new Logger(ModerationCommands.name);
  private readonly pendingKicks = new Map<string, PendingKick>();
  private readonly pendingBans = new Map<string, PendingBan>();
  private readonly pendingUnbans = new Map<string, PendingUnban>();
  private readonly pendingPurges = new Map<string, PendingPurge>();
  private readonly purgingChannels = new Set<string>();
  private readonly pendingChannelLocks = new Map<string, PendingChannelLock>();
  private readonly changingChannels = new Set<string>();
  private readonly pendingTimedActions = new Map<string, PendingTimedAction>();

  constructor(
    private readonly moderation: ModerationService,
    // Optional for backwards-compatible direct construction in existing
    // moderation command unit tests; Nest injects this in the live module.
    @Optional() private readonly purges?: ModerationPurgeService,
    @Optional() private readonly channelLocks?: ModerationChannelLockService,
  ) {}

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

  /**
   * Fail closed when we cannot confirm an actual Discord ban. The user has
   * no server roles while banned, so the only valid hierarchy requirement
   * is the Ban Members permission of the moderator and Yuugen.
   */
  private async unbanEligibility(
    staff: StaffContext,
    actorId: string,
    targetId: string,
  ): Promise<string | null> {
    const botMember = await staff.guild.members.fetchMe().catch(() => null);
    const denial = getUnbanDenial({
      actorId,
      targetId,
      guildOwnerId: staff.guild.ownerId,
      actorHasBanMembers: staff.moderator.permissions.has(
        PermissionFlagsBits.BanMembers,
      ),
      botHasBanMembers: !!botMember?.permissions.has(
        PermissionFlagsBits.BanMembers,
      ),
    });
    if (denial) return denial;

    try {
      // Force a fresh Discord API check instead of trusting cached bans.
      // Do this both on preview and immediately before unbanning.
      const ban = await staff.guild.bans.fetch({
        user: targetId,
        force: true,
      });
      if (ban.user.id !== targetId) {
        return 'Discord returned an unexpected ban record. No unban attempted.';
      }
      return null;
    } catch (error) {
      if (isUnknownBanError(error)) {
        return 'This user is not currently banned in this server.';
      }
      this.logger.warn('Failed to verify guild ban list for unban');
      return 'Could not verify the Discord ban list. No unban attempted.';
    }
  }

  private cleanupPendingUnbans(): void {
    const now = Date.now();
    for (const [messageId, pending] of this.pendingUnbans) {
      if (pending.expiresAt <= now) this.pendingUnbans.delete(messageId);
    }
  }

  @Subcommand({
    name: 'unban',
    description: 'Remove a permanent ban after confirmation',
  })
  public async onUnban(
    @Context() [interaction]: SlashCommandContext,
    @Options() { userId, reason }: UnbanOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const staff = await this.staffContext(
      interaction, PermissionFlagsBits.BanMembers,
    );
    if (!staff) {
      return interaction.editReply(
        'You need the Ban Members permission in this server.',
      );
    }

    const targetId = typeof userId === 'string' ? userId.trim() : '';
    const cleanedReason = typeof reason === 'string'
      ? reason.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
      : '';
    if (!/^\d{17,20}$/.test(targetId)) {
      return interaction.editReply('Provide a valid 17-20 digit Discord user ID.');
    }
    if (cleanedReason.length < 1 || cleanedReason.length > 512) {
      return interaction.editReply(
        'Give an unban reason between 1 and 512 characters.',
      );
    }

    const denial = await this.unbanEligibility(
      staff, interaction.user.id, targetId,
    );
    if (denial) return interaction.editReply(denial);

    this.cleanupPendingUnbans();
    if (this.pendingUnbans.size >= 100) {
      return interaction.editReply(
        'Too many outstanding unban confirmations. Try again shortly.',
      );
    }

    const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('mod-unban-confirm')
        .setLabel('Confirm unban')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('mod-unban-cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );
    const message = await interaction.editReply({
      content: '**Confirm unban of <@' + targetId + '>**\nReason: ' +
        escapeMarkdown(cleanedReason) +
        '\nThis allows the user to join the server again. ' +
        'Only you can confirm. Expires in 60 seconds.',
      components: [controls],
      allowedMentions: { parse: [] },
    });
    this.pendingUnbans.set(message.id, {
      guildId: staff.guild.id,
      actorId: interaction.user.id,
      targetId,
      reason: cleanedReason,
      expiresAt: Date.now() + 60_000,
    });
  }

  @Button('mod-unban-cancel')
  public async onUnbanCancel(@Context() [interaction]: ButtonContext) {
    const pending = this.pendingUnbans.get(interaction.message.id);
    if (!pending || pending.actorId !== interaction.user.id ||
        pending.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'This unban confirmation is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }
    this.pendingUnbans.delete(interaction.message.id);
    return interaction.update({
      content: 'Unban canceled. The user's ban remains in effect.',
      components: [],
    });
  }

  @Button('mod-unban-confirm')
  public async onUnbanConfirm(@Context() [interaction]: ButtonContext) {
    const pending = this.pendingUnbans.get(interaction.message.id);
    if (!pending || pending.actorId !== interaction.user.id ||
        pending.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'This unban confirmation is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Consume synchronously before awaiting any network or database call.
    this.pendingUnbans.delete(interaction.message.id);
    await interaction.deferUpdate();
    if (pending.expiresAt <= Date.now()) {
      return interaction.editReply({
        content: 'Unban confirmation expired. Use /mod unban again.',
        components: [],
      });
    }

    const staff = await this.staffContext(
      interaction, PermissionFlagsBits.BanMembers,
    );
    if (!staff || staff.guild.id !== pending.guildId) {
      return interaction.editReply({
        content: 'Unban canceled: you no longer have Ban Members permission.',
        components: [],
      });
    }
    const denial = await this.unbanEligibility(
      staff, interaction.user.id, pending.targetId,
    );
    if (denial) {
      return interaction.editReply({
        content: 'Unban canceled: ' + denial,
        components: [],
      });
    }

    let record: Awaited<ReturnType<ModerationService['beginUnban']>>;
    try {
      // No audit record means no external action.
      record = await this.moderation.beginUnban(
        pending.guildId, pending.targetId, pending.actorId, pending.reason,
      );
    } catch (error) {
      this.logger.error('Unban case write failed; Discord unban skipped', error);
      return interaction.editReply({
        content: 'No unban attempted: Yuugen could not save the audit case.',
        components: [],
      });
    }

    try {
      const auditReason = (
        'Yuugen case #' + record.id + ', moderator ' +
        pending.actorId + ': ' + pending.reason
      ).slice(0, 512);
      await staff.guild.bans.remove(pending.targetId, auditReason);
    } catch (error) {
      // A network timeout cannot establish whether the unban succeeded.
      // Only an explicit forbidden or Unknown Ban response is definitive.
      const status = error && typeof error === 'object' && 'status' in error
        ? (error as { status?: unknown }).status : null;
      const definitiveFailure = status === 403 || isUnknownBanError(error);
      let recordedFailure = false;
      if (definitiveFailure) {
        try {
          recordedFailure = !!await this.moderation.finalizeUnban(
            pending.guildId, record.id, 'unban_failed',
          );
        } catch (saveError) {
          this.logger.error(
            'Unban failure case finalization failed', saveError,
          );
        }
      }
      this.logger.warn(
        'Discord unban case #' + record.id +
        (definitiveFailure ? ' rejected' : ' has uncertain outcome'),
      );
      return interaction.editReply({
        content: recordedFailure
          ? 'Discord rejected the unban. Case #' + record.id + ' is marked failed.'
          : 'Unban outcome is unconfirmed. Case #' + record.id +
            ' remains pending. Check the Discord ban list before retrying.',
        components: [],
      });
    }

    let finalized = false;
    try {
      finalized = !!await this.moderation.finalizeUnban(
        pending.guildId, record.id, 'unban',
      );
    } catch (error) {
      this.logger.error('Unban succeeded but audit finalization failed', error);
    }
    if (!finalized) {
      return interaction.editReply({
        content: 'The user was unbanned, but case #' + record.id +
          ' is still pending. Staff must reconcile the case.',
        components: [],
      });
    }
    return interaction.editReply({
      content: 'Unbanned <@' + pending.targetId +
        '> from this server. Case #' + record.id + ' recorded.',
      components: [],
      allowedMentions: { parse: [] },
    });
  }

  /**
   * Member timeout permissions/hierarchy must be reloaded from Discord on
   * preview and confirmation. A missing or stale member fails closed.
   */
  private async timedActionEligibility(
    staff: StaffContext,
    actorId: string,
    targetId: string,
    action: TimeoutAction,
  ): Promise<{ member: GuildMember | null; denial: string | null }> {
    const [member, botMember] = await Promise.all([
      staff.guild.members.fetch({ user: targetId, force: true })
        .catch(() => null),
      staff.guild.members.fetchMe().catch(() => null),
    ]);
    const currentlyTimedOut = !!member &&
      typeof member.communicationDisabledUntilTimestamp === 'number' &&
      member.communicationDisabledUntilTimestamp > Date.now();
    const denial = getTimeoutDenial({
      action,
      actorId,
      targetId,
      guildOwnerId: staff.guild.ownerId,
      actorHasModerateMembers: staff.moderator.permissions.has(
        PermissionFlagsBits.ModerateMembers,
      ),
      botHasModerateMembers: !!botMember?.permissions.has(
        PermissionFlagsBits.ModerateMembers,
      ),
      targetIsMember: !!member,
      targetIsBot: member?.user.bot === true,
      actorRoleAboveTarget: !!member &&
        staff.moderator.roles.highest.comparePositionTo(member.roles.highest) > 0,
      targetModeratable: member?.moderatable === true,
      currentlyTimedOut,
    });
    return { member, denial };
  }

  private cleanPendingTimedActions(): void {
    const now = Date.now();
    for (const [messageId, pending] of this.pendingTimedActions) {
      if (pending.confirmationExpiresAt <= now) {
        this.pendingTimedActions.delete(messageId);
      }
    }
  }

  private async previewTimedAction(
    interaction: ChatInputCommandInteraction,
    user: User,
    reason: string,
    action: TimeoutAction,
    durationText?: string,
  ) {
    const staff = await this.staffContext(
      interaction, PermissionFlagsBits.ModerateMembers,
    );
    if (!staff) {
      return interaction.editReply(
        'You need the Moderate Members permission in this server.',
      );
    }
    const cleanedReason = typeof reason === 'string'
      ? reason.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
      : '';
    if (cleanedReason.length < 1 || cleanedReason.length > 512) {
      return interaction.editReply('Give a reason between 1 and 512 characters.');
    }

    const durationMs = action === 'timeout'
      ? parseTimeoutDuration(durationText)
      : null;
    if (action === 'timeout' && durationMs === null) {
      return interaction.editReply(
        'Invalid duration. Use 1m to 28d, e.g. 10m, 2h or 7d.',
      );
    }

    const { denial } = await this.timedActionEligibility(
      staff, interaction.user.id, user.id, action,
    );
    if (denial) return interaction.editReply(denial);

    this.cleanPendingTimedActions();
    if (this.pendingTimedActions.size >= 100) {
      return interaction.editReply(
        'Too many pending moderation confirmations. Try again shortly.',
      );
    }

    const label = action === 'timeout' ? 'timeout' : 'remove timeout';
    const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('mod-' + action + '-confirm')
        .setLabel(action === 'timeout' ? 'Confirm timeout' : 'Confirm removal')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('mod-' + action + '-cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );
    const displayDuration = durationMs !== null
      ? '\nDuration: ' + formatTimeoutDuration(durationMs)
      : '';
    const message = await interaction.editReply({
      content: '**Confirm ' + label + ' for <@' + user.id + '>**' +
        displayDuration + '\nReason: ' + escapeMarkdown(cleanedReason) +
        '\nOnly you can confirm. Expires in 60 seconds.',
      components: [controls],
      allowedMentions: { parse: [] },
    });
    this.pendingTimedActions.set(message.id, {
      guildId: staff.guild.id,
      actorId: interaction.user.id,
      targetId: user.id,
      reason: cleanedReason,
      action,
      durationMs: durationMs === null ? undefined : durationMs,
      confirmationExpiresAt: Date.now() + 60_000,
    });
  }

  @Subcommand({
    name: 'timeout',
    description: 'Temporarily restrict a member after confirmation',
  })
  public async onTimeout(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, duration, reason }: TimeoutOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return this.previewTimedAction(
      interaction, user, reason, 'timeout', duration,
    );
  }

  @Subcommand({
    name: 'untimeout',
    description: 'Remove a member timeout after confirmation',
  })
  public async onUntimeout(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, reason }: UntimeoutOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return this.previewTimedAction(
      interaction, user, reason, 'untimeout',
    );
  }

  private async cancelTimedAction(
    interaction: ButtonInteraction,
    action: TimeoutAction,
  ) {
    const pending = this.pendingTimedActions.get(interaction.message.id);
    if (!pending || pending.action !== action ||
        pending.actorId !== interaction.user.id ||
        pending.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'This moderation confirmation is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }
    this.pendingTimedActions.delete(interaction.message.id);
    return interaction.update({
      content: 'Moderation action canceled. No Discord timeout was changed.',
      components: [],
    });
  }

  @Button('mod-timeout-cancel')
  public async onTimeoutCancel(@Context() [interaction]: ButtonContext) {
    return this.cancelTimedAction(interaction, 'timeout');
  }

  @Button('mod-untimeout-cancel')
  public async onUntimeoutCancel(@Context() [interaction]: ButtonContext) {
    return this.cancelTimedAction(interaction, 'untimeout');
  }

  private async confirmTimedAction(
    interaction: ButtonInteraction,
    action: TimeoutAction,
  ) {
    const pending = this.pendingTimedActions.get(interaction.message.id);
    if (!pending || pending.action !== action ||
        pending.actorId !== interaction.user.id ||
        pending.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'This moderation confirmation is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Consume synchronously before the first async call to prevent a replay.
    this.pendingTimedActions.delete(interaction.message.id);
    await interaction.deferUpdate();
    if (pending.confirmationExpiresAt <= Date.now()) {
      return interaction.editReply({
        content: 'Confirmation expired. Run the moderation command again.',
        components: [],
      });
    }

    const staff = await this.staffContext(
      interaction, PermissionFlagsBits.ModerateMembers,
    );
    if (!staff || staff.guild.id !== pending.guildId) {
      return interaction.editReply({
        content: 'Action canceled: you no longer have Moderate Members permission.',
        components: [],
      });
    }
    const { member, denial } = await this.timedActionEligibility(
      staff, interaction.user.id, pending.targetId, action,
    );
    if (denial || !member) {
      return interaction.editReply({
        content: 'Action canceled: ' + (denial || 'Member is unavailable.'),
        components: [],
      });
    }

    // The expiry will be computed by Discord from the time of the API call.
    // The case stores an approximate intended end for audit purposes only.
    const durationMs = action === 'timeout' ? pending.durationMs : undefined;
    let record: Awaited<ReturnType<ModerationService['beginTimedAction']>>;
    try {
      record = await this.moderation.beginTimedAction(
        pending.guildId,
        pending.targetId,
        pending.actorId,
        pending.reason,
        action,
        durationMs,
      );
    } catch (error) {
      this.logger.error('Timed moderation case could not be saved', error);
      return interaction.editReply({
        content: 'No timeout action attempted: Yuugen could not save the case.',
        components: [],
      });
    }

    try {
      const auditReason = (
        'Yuugen case #' + record.id + ', moderator ' +
        pending.actorId + ': ' + pending.reason
      ).slice(0, 512);
      await member.timeout(action === 'timeout' ? durationMs! : null, auditReason);
    } catch (error) {
      // A network timeout is ambiguous: Discord may have changed the member.
      const definitive = isDefinitiveTimeoutRejection(error);
      let markedFailed = false;
      if (definitive) {
        try {
          markedFailed = !!await this.moderation.finalizeTimedAction(
            pending.guildId, record.id, action, 'failed',
          );
        } catch (saveError) {
          this.logger.error('Failed to record Discord rejection', saveError);
        }
      }
      this.logger.warn(
        'Timed moderation case #' + record.id +
        (definitive ? ' rejected by Discord' : ' has unknown outcome'),
      );
      return interaction.editReply({
        content: markedFailed
          ? 'Discord rejected this action. Case #' + record.id + ' is marked failed.'
          : 'Outcome unconfirmed. Case #' + record.id +
            ' remains pending. Verify the member timeout in Discord before retrying.',
        components: [],
      });
    }

    let finalized = false;
    try {
      finalized = !!await this.moderation.finalizeTimedAction(
        pending.guildId, record.id, action, 'success',
      );
    } catch (error) {
      this.logger.error('Timeout succeeded but case finalization failed', error);
    }
    if (!finalized) {
      return interaction.editReply({
        content: 'Discord accepted the timeout change, but case #' + record.id +
          ' remains pending. Staff must reconcile the case.',
        components: [],
      });
    }

    return interaction.editReply({
      content: (action === 'timeout' ? 'Timed out ' : 'Removed timeout for ') +
        '<@' + pending.targetId + '>.' +
        (action === 'timeout' && durationMs
          ? ' Duration: ' + formatTimeoutDuration(durationMs) + '.'
          : '') +
        ' Case #' + record.id + ' recorded.',
      components: [],
      allowedMentions: { parse: [] },
    });
  }

  @Button('mod-timeout-confirm')
  public async onTimeoutConfirm(@Context() [interaction]: ButtonContext) {
    return this.confirmTimedAction(interaction, 'timeout');
  }

  @Button('mod-untimeout-confirm')
  public async onUntimeoutConfirm(@Context() [interaction]: ButtonContext) {
    return this.confirmTimedAction(interaction, 'untimeout');
  }

  private async resolvePurgeChannel(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    channelId: string,
  ): Promise<TextChannel | NewsChannel | null> {
    const guild = interaction.guild;
    if (!guild || !DISCORD_SNOWFLAKE.test(channelId)) return null;
    // Force Discord API fetch: cached channel overwrites may have changed.
    const fetched = await guild.channels.fetch(channelId, {
      force: true,
    }).catch(() => null);
    if (!fetched || fetched.guildId !== guild.id ||
        (fetched.type !== ChannelType.GuildText &&
         fetched.type !== ChannelType.GuildAnnouncement)) {
      return null;
    }
    return fetched as TextChannel | NewsChannel;
  }

  private async purgePermissionDenial(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    channel: TextChannel | NewsChannel,
  ): Promise<string | null> {
    const guild = interaction.guild;
    if (!guild) return 'This command must be used in a server.';
    const [actor, bot] = await Promise.all([
      guild.members.fetch({
        user: interaction.user.id,
        force: true,
      }).catch(() => null),
      guild.members.fetchMe().catch(() => null),
    ]);
    const actorPerms = actor ? channel.permissionsFor(actor) : null;
    const botPerms = bot ? channel.permissionsFor(bot) : null;
    return getPurgeDenial({
      actorCanView: !!actorPerms?.has(PermissionFlagsBits.ViewChannel),
      actorCanManage: !!actorPerms?.has(PermissionFlagsBits.ManageMessages),
      botCanView: !!botPerms?.has(PermissionFlagsBits.ViewChannel),
      botCanReadHistory: !!botPerms?.has(PermissionFlagsBits.ReadMessageHistory),
      botCanManage: !!botPerms?.has(PermissionFlagsBits.ManageMessages),
    });
  }

  private cleanupPendingPurges(): void {
    const now = Date.now();
    for (const [id, pending] of this.pendingPurges) {
      if (pending.expiresAt <= now) this.pendingPurges.delete(id);
    }
  }

  @Subcommand({
    name: 'purge',
    description: 'Preview and remove up to 100 recent eligible messages',
  })
  public async onPurge(
    @Context() [interaction]: SlashCommandContext,
    @Options() { count, reason, user, userId, channel: selectedChannel }: PurgeOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId || !interaction.guild) {
      return interaction.editReply('Use this command inside a server.');
    }
    if (!this.purges) {
      return interaction.editReply('Purge auditing is not configured.');
    }
    if (validatePurgeCount(count) === null) {
      return interaction.editReply('Purge count must be from 1 to 100.');
    }
    const cleanedReason = typeof reason === 'string'
      ? reason.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
      : '';
    if (!cleanedReason || cleanedReason.length > 512) {
      return interaction.editReply('Give a reason between 1 and 512 characters.');
    }
    if (user && userId) {
      return interaction.editReply('Provide either user or user_id, not both.');
    }
    const filterUserId = user?.id || (userId?.trim() || null);
    if (filterUserId && !DISCORD_SNOWFLAKE.test(filterUserId)) {
      return interaction.editReply('Invalid author ID (17-20 digits required).');
    }
    if (selectedChannel && selectedChannel.guildId !== interaction.guildId) {
      return interaction.editReply('You can only purge channels in this server.');
    }
    const channelId = selectedChannel?.id || interaction.channelId;
    const channel = await this.resolvePurgeChannel(interaction, channelId);
    if (!channel) {
      return interaction.editReply(
        'Choose a server text or announcement channel (threads are not supported).',
      );
    }
    const denial = await this.purgePermissionDenial(interaction, channel);
    if (denial) return interaction.editReply(denial);

    if (this.purgingChannels.has(channel.id)) {
      return interaction.editReply('A purge is already running in this channel.');
    }
    let plan: PurgePlan<Message<true>>;
    try {
      plan = await buildPurgePlan(channel, count, filterUserId);
    } catch (error) {
      this.logger.error('Could not preview purge messages', error);
      return interaction.editReply('Could not read channel history to preview the purge.');
    }
    if (plan.messages.length === 0) {
      return interaction.editReply(
        'No eligible recent messages found in <#' + channel.id +
        '> (scanned ' + plan.scannedCount + ' messages).' +
        ' Pinned, system, protected and older-than-two-week messages are skipped.',
      );
    }

    this.cleanupPendingPurges();
    if (this.pendingPurges.size >= 100) {
      return interaction.editReply('Too many pending purge confirmations. Try later.');
    }

    const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('mod-purge-confirm')
        .setLabel('Delete ' + plan.messages.length + ' messages')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('mod-purge-cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );
    const message = await interaction.editReply({
      content: '**Confirm purge in <#' + channel.id + '>**\n' +
        '**Selected:** ' + plan.messages.length + ' of ' + count + ' requested. ' +
        '**Scanned:** ' + plan.scannedCount + '.\n' +
        'Excluded: ' + plan.skippedProtectedCount + ' pinned/protected, ' +
        plan.skippedOldCount + ' too old.' +
        (plan.scanLimitReached ? ' Search capped at 500 messages.' : '') +
        (filterUserId ? '\nAuthor: <@' + filterUserId + '>' : '') +
        '\nReason: ' + escapeMarkdown(cleanedReason) +
        '\nOnly you can confirm within 60 seconds. ' +
        'If the selected messages change, this request is canceled.',
      components: [controls],
      allowedMentions: { parse: [] },
    });
    this.pendingPurges.set(message.id, {
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      channelId: channel.id,
      filterUserId,
      reason: cleanedReason,
      requestedCount: count,
      messageIds: plan.messages.map(x => x.id),
      expiresAt: Date.now() + 60_000,
    });
  }

  @Button('mod-purge-cancel')
  public async onPurgeCancel(@Context() [interaction]: ButtonContext) {
    const pending = this.pendingPurges.get(interaction.message.id);
    if (!pending || pending.actorId !== interaction.user.id ||
        pending.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'This purge request is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }
    this.pendingPurges.delete(interaction.message.id);
    return interaction.update({
      content: 'Purge canceled. No messages were deleted.',
      components: [],
    });
  }

  @Button('mod-purge-confirm')
  public async onPurgeConfirm(@Context() [interaction]: ButtonContext) {
    const pending = this.pendingPurges.get(interaction.message.id);
    if (!pending || pending.actorId !== interaction.user.id ||
        pending.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'This purge request is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Consume before the first await: no duplicate deletes from double clicks.
    this.pendingPurges.delete(interaction.message.id);
    await interaction.deferUpdate();
    if (pending.expiresAt <= Date.now()) {
      return interaction.editReply({
        content: 'Purge confirmation expired. Run /mod purge again.',
        components: [],
      });
    }
    if (!this.purges) {
      return interaction.editReply({
        content: 'Purge auditing is unavailable. No messages were deleted.',
        components: [],
      });
    }
    if (this.purgingChannels.has(pending.channelId)) {
      return interaction.editReply({
        content: 'Another purge is running in this channel. Run /mod purge again.',
        components: [],
      });
    }

    this.purgingChannels.add(pending.channelId);
    try {
      const channel = await this.resolvePurgeChannel(
        interaction, pending.channelId,
      );
      if (!channel || channel.guildId !== pending.guildId) {
        return interaction.editReply({
          content: 'Purge canceled: channel is no longer available.',
          components: [],
        });
      }
      const denial = await this.purgePermissionDenial(interaction, channel);
      if (denial) {
        return interaction.editReply({
          content: 'Purge canceled: ' + denial,
          components: [],
        });
      }

      // Re-fetch with a cold cache; do not delete messages added/replaced
      // after the preview. Pinned and age-expired messages also invalidate
      // the preview to avoid silently deleting an unexpected selection.
      let plan: PurgePlan<Message<true>>;
      try {
        plan = await buildPurgePlan(
          channel, pending.requestedCount, pending.filterUserId,
        );
      } catch (error) {
        this.logger.error('Could not revalidate purge selection', error);
        return interaction.editReply({
          content: 'Purge canceled: could not re-check message history.',
          components: [],
        });
      }
      if (!samePurgeSelection(
        pending.messageIds, plan.messages.map(x => x.id),
      )) {
        return interaction.editReply({
          content: 'Purge canceled: message selection changed since preview. ' +
            'Run /mod purge again.',
          components: [],
        });
      }

      let record: Awaited<ReturnType<ModerationPurgeService['begin']>>;
      try {
        record = await this.purges.begin({
          guildId: pending.guildId,
          channelId: pending.channelId,
          moderatorUserId: pending.actorId,
          filterUserId: pending.filterUserId,
          reason: pending.reason,
          requestedCount: pending.requestedCount,
          selectedMessageIds: pending.messageIds,
          scannedCount: plan.scannedCount,
          skippedOldCount: plan.skippedOldCount,
          skippedProtectedCount: plan.skippedProtectedCount,
        });
      } catch (error) {
        this.logger.error('Failed to store purge audit: no Discord action attempted', error);
        return interaction.editReply({
          content: 'No deletion attempted: could not save the moderation audit.',
          components: [],
        });
      }

      let deletedIds: string[];
      try {
        if (plan.messages.length === 1) {
          // Discord's bulk delete API requires at least two message IDs.
          await plan.messages[0].delete();
          deletedIds = [plan.messages[0].id];
        } else {
          // Always filter old IDs even though the selection already has a
          // conservative age cutoff: Discord can reject IDs >14 days old.
          const deleted = await channel.bulkDelete(plan.messages, true);
          deletedIds = [...deleted.keys()];
        }
      } catch (error) {
        const data = error && typeof error === 'object'
          ? error as { status?: unknown; code?: unknown } : {};
        const definitive = data.status === 403 ||
          data.code === 50013 || data.code === 50034 ||
          data.code === 10008 || data.code === 10003;
        let failed = false;
        if (definitive) {
          try {
            failed = !!await this.purges.finish(
              pending.guildId, record.id, pending.messageIds.length, [],
            );
          } catch (saveError) {
            this.logger.error('Could not finalize rejected purge', saveError);
          }
        }
        this.logger.warn('Discord purge case #' + record.id +
          (definitive ? ' rejected' : ' has an uncertain outcome'));
        return interaction.editReply({
          content: failed
            ? 'Discord rejected the purge. Audit #' + record.id + ' is marked failed.'
            : 'Purge outcome unconfirmed. Audit #' + record.id +
              ' remains pending; inspect channel history before retrying.',
          components: [],
        });
      }

      let finished: Awaited<ReturnType<ModerationPurgeService['finish']>> = null;
      try {
        finished = await this.purges.finish(
          pending.guildId, record.id, pending.messageIds.length, deletedIds,
        );
      } catch (error) {
        this.logger.error('Purge completed but audit finalization failed', error);
      }
      if (!finished) {
        return interaction.editReply({
          content: 'Discord accepted the purge request, but audit #' +
            record.id + ' remains pending. Staff must reconcile it.',
          components: [],
        });
      }
      return interaction.editReply({
        content: 'Purge audit #' + record.id + ': deleted ' +
          deletedIds.length + ' of ' + pending.messageIds.length +
          ' selected messages from <#' + pending.channelId + '> (' +
          finished.status + ').' +
          (finished.status === 'partial'
            ? ' Some messages were skipped; review the audit before retrying.'
            : ''),
        components: [],
        allowedMentions: { parse: [] },
      });
    } finally {
      this.purgingChannels.delete(pending.channelId);
    }
  }

  private readEveryoneOverwrite(
    channel: TextChannel | NewsChannel,
  ): OverwriteSnapshot {
    const found = channel.permissionOverwrites.cache.get(channel.guild.id);
    return {
      existed: !!found,
      allow: found ? found.allow.bitfield.toString() : '0',
      deny: found ? found.deny.bitfield.toString() : '0',
    };
  }

  private async lockPermissionDenial(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    channel: TextChannel | NewsChannel,
  ): Promise<string | null> {
    const guild = interaction.guild;
    if (!guild) return 'This command must be used in a server.';
    const [actor, bot] = await Promise.all([
      guild.members.fetch({
        user: interaction.user.id,
        force: true,
      }).catch(() => null),
      guild.members.fetchMe().catch(() => null),
    ]);
    const actorPerms = actor ? channel.permissionsFor(actor) : null;
    const botPerms = bot ? channel.permissionsFor(bot) : null;
    return getChannelLockDenial({
      actorCanView: !!actorPerms?.has(PermissionFlagsBits.ViewChannel),
      actorCanManageChannels: !!actorPerms?.has(PermissionFlagsBits.ManageChannels),
      actorCanManageRoles: !!actorPerms?.has(PermissionFlagsBits.ManageRoles),
      botCanView: !!botPerms?.has(PermissionFlagsBits.ViewChannel),
      botCanManageChannels: !!botPerms?.has(PermissionFlagsBits.ManageChannels),
      botCanManageRoles: !!botPerms?.has(PermissionFlagsBits.ManageRoles),
    });
  }

  private clearExpiredChannelLockPrompts(): void {
    const now = Date.now();
    for (const [messageId, pending] of this.pendingChannelLocks) {
      if (pending.expiresAt <= now) this.pendingChannelLocks.delete(messageId);
    }
  }

  private async previewChannelLock(
    interaction: ChatInputCommandInteraction,
    selectedChannel: GuildChannel | undefined,
    reason: string,
    action: ChannelLockAction,
  ) {
    if (!interaction.guild || !interaction.guildId || !this.channelLocks) {
      return interaction.editReply('Channel locks are not configured in this server.');
    }
    const cleanedReason = getChannelLockReason(reason);
    if (!cleanedReason) {
      return interaction.editReply('Give a reason between 1 and 512 characters.');
    }
    if (selectedChannel && selectedChannel.guildId !== interaction.guildId) {
      return interaction.editReply('The selected channel belongs to another server.');
    }
    const channel = await this.resolvePurgeChannel(
      interaction, selectedChannel?.id || interaction.channelId,
    );
    if (!channel) {
      return interaction.editReply(
        'Choose a server text or announcement channel; threads are unsupported.',
      );
    }
    const denial = await this.lockPermissionDenial(interaction, channel);
    if (denial) return interaction.editReply(denial);

    let active: ModerationChannelLock | null;
    try {
      active = await this.channelLocks.getActive(interaction.guildId, channel.id);
    } catch (error) {
      this.logger.error('Cannot read channel lock state', error);
      return interaction.editReply('Could not load the channel lock audit.');
    }

    let snapshot: LockSnapshot | undefined;
    let lockId: number | undefined;
    if (action === 'lock') {
      if (active) {
        return interaction.editReply(
          'This channel has an active or unresolved Yuugen lock (case #' +
          active.id + ', ' + active.status + '). Resolve it before locking again.',
        );
      }
      // Modifying a category-synced child permanently desynchronizes it;
      // refuse instead of promising to restore automatic category syncing.
      if (channel.permissionsLocked === true) {
        return interaction.editReply(
          'This channel syncs permissions with its category. ' +
          'Desync it deliberately in Discord first or lock the category manually.',
        );
      }
      try {
        snapshot = makeLockSnapshot(this.readEveryoneOverwrite(channel));
      } catch (error) {
        return interaction.editReply(
          'Cannot lock this channel: @everyone Send Messages is already denied ' +
          'or its overwrite is invalid.',
        );
      }
    } else {
      if (!active || active.status !== 'locked') {
        return interaction.editReply(
          active
            ? 'Lock case #' + active.id + ' is ' + active.status +
              '. Resolve it before unlocking.'
            : 'This channel has no active Yuugen-managed lock.',
        );
      }
      if (!matchesLockedSnapshot(active, this.readEveryoneOverwrite(channel))) {
        return interaction.editReply(
          'Channel permissions changed since lock #' + active.id +
          '. Refusing to overwrite staff changes. Reconcile manually.',
        );
      }
      lockId = active.id;
    }
    this.clearExpiredChannelLockPrompts();
    if (this.pendingChannelLocks.size >= 100) {
      return interaction.editReply('Too many pending lock confirmations. Try shortly.');
    }
    const components = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('mod-channel-' + action + '-confirm')
        .setLabel(action === 'lock' ? 'Confirm lock' : 'Confirm unlock')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('mod-channel-' + action + '-cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );
    const message = await interaction.editReply({
      content: '**Confirm channel ' + action + ' for <#' + channel.id + '>**' +
        '\nReason: ' + escapeMarkdown(cleanedReason) +
        (action === 'lock'
          ? '\nChanges only @everyone Send Messages to Deny.' +
            ' Explicit role allowances and Administrators may still post.'
          : '\nRestores the saved @everyone Send Messages setting only.' +
            ' Existing role/member overwrites are never modified.') +
        '\nOnly you can confirm within 60 seconds.',
      components: [components],
      allowedMentions: { parse: [] },
    });
    this.pendingChannelLocks.set(message.id, {
      action,
      guildId: interaction.guildId,
      channelId: channel.id,
      actorId: interaction.user.id,
      reason: cleanedReason,
      snapshot,
      lockId,
      expiresAt: Date.now() + 60_000,
    });
  }

  @Subcommand({
    name: 'lock',
    description: 'Lock @everyone posting in a text channel after confirmation',
  })
  public async onLock(
    @Context() [interaction]: SlashCommandContext,
    @Options() { reason, channel }: ChannelLockOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return this.previewChannelLock(interaction, channel, reason, 'lock');
  }

  @Subcommand({
    name: 'unlock',
    description: 'Restore a Yuugen-managed channel posting lock',
  })
  public async onUnlock(
    @Context() [interaction]: SlashCommandContext,
    @Options() { reason, channel }: ChannelUnlockOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return this.previewChannelLock(interaction, channel, reason, 'unlock');
  }

  @Subcommand({
    name: 'lockstatus',
    description: 'Inspect a channel lock or unresolved permission change',
  })
  public async onLockStatus(
    @Context() [interaction]: SlashCommandContext,
    @Options() { channel: selectedChannel }: ChannelLockStatusOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId || !this.channelLocks) {
      return interaction.editReply('Channel lock auditing is unavailable.');
    }
    if (selectedChannel && selectedChannel.guildId !== interaction.guildId) {
      return interaction.editReply('Choose a channel in the current guild.');
    }
    const channel = await this.resolvePurgeChannel(
      interaction, selectedChannel?.id || interaction.channelId,
    );
    if (!channel) return interaction.editReply('Unsupported or unavailable channel.');
    const denial = await this.lockPermissionDenial(interaction, channel);
    if (denial) return interaction.editReply(denial);
    try {
      const active = await this.channelLocks.getActive(
        interaction.guildId, channel.id,
      );
      if (!active) {
        return interaction.editReply(
          'No active Yuugen-managed channel lock for <#' + channel.id + '>.',
        );
      }
      const matches = matchesLockedSnapshot(
        active, this.readEveryoneOverwrite(channel),
      );
      return interaction.editReply({
        content: '**Channel <#' + channel.id + '>**\nLock case #' +
          active.id + ' · ' + active.status +
          '\nActor <@' + active.lockedByUserId + '>' +
          '\nReason: ' + escapeMarkdown(active.lockReason) +
          '\nOverwrite matches recorded lock: ' + (matches ? 'yes' : 'NO') +
          (active.status === 'locked' && matches
            ? '\nUse /mod unlock to restore the previous state.'
            : '\nRequires moderator review before another change.'),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.logger.error('Could not read lock status', error);
      return interaction.editReply('Could not load the channel lock status.');
    }
  }

  private async cancelChannelLock(
    interaction: ButtonInteraction,
    action: ChannelLockAction,
  ) {
    const pending = this.pendingChannelLocks.get(interaction.message.id);
    if (!pending || pending.action !== action ||
        pending.guildId !== interaction.guildId ||
        pending.actorId !== interaction.user.id) {
      return interaction.reply({
        content: 'This lock confirmation is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }
    this.pendingChannelLocks.delete(interaction.message.id);
    return interaction.update({
      content: 'Channel change canceled. No permissions were modified.',
      components: [],
    });
  }

  @Button('mod-channel-lock-cancel')
  public async onLockCancel(@Context() [interaction]: ButtonContext) {
    return this.cancelChannelLock(interaction, 'lock');
  }

  @Button('mod-channel-unlock-cancel')
  public async onUnlockCancel(@Context() [interaction]: ButtonContext) {
    return this.cancelChannelLock(interaction, 'unlock');
  }

  private async confirmChannelLock(
    interaction: ButtonInteraction,
    action: ChannelLockAction,
  ) {
    const pending = this.pendingChannelLocks.get(interaction.message.id);
    if (!pending || pending.action !== action ||
        pending.guildId !== interaction.guildId ||
        pending.actorId !== interaction.user.id) {
      return interaction.reply({
        content: 'This lock confirmation is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }
    this.pendingChannelLocks.delete(interaction.message.id);
    await interaction.deferUpdate();
    if (pending.expiresAt <= Date.now()) {
      return interaction.editReply({
        content: 'Lock confirmation expired. Run the command again.',
        components: [],
      });
    }
    if (!interaction.guild || !this.channelLocks) {
      return interaction.editReply({
        content: 'Lock auditing is unavailable. No change attempted.',
        components: [],
      });
    }
    if (this.changingChannels.has(pending.channelId)) {
      return interaction.editReply({
        content: 'Another change is already underway for this channel.',
        components: [],
      });
    }
    this.changingChannels.add(pending.channelId);
    try {
      const channel = await this.resolvePurgeChannel(
        interaction, pending.channelId,
      );
      if (!channel || channel.guildId !== pending.guildId) {
        return interaction.editReply({
          content: 'Channel is unavailable. No change attempted.',
          components: [],
        });
      }
      const denial = await this.lockPermissionDenial(interaction, channel);
      if (denial) {
        return interaction.editReply({
          content: 'Action canceled: ' + denial, components: [],
        });
      }

      const current = this.readEveryoneOverwrite(channel);
      let record: ModerationChannelLock | null;
      if (action === 'lock') {
        if (channel.permissionsLocked === true) {
          return interaction.editReply({
            content: 'Channel now syncs with its category. No change attempted.',
            components: [],
          });
        }
        let snapshot: LockSnapshot;
        try {
          snapshot = makeLockSnapshot(current);
        } catch (error) {
          return interaction.editReply({
            content: 'Channel is already denied or permissions are invalid.',
            components: [],
          });
        }
        if (!pending.snapshot ||
            JSON.stringify(snapshot) !== JSON.stringify(pending.snapshot)) {
          return interaction.editReply({
            content: 'Channel permissions changed since preview. Run /mod lock again.',
            components: [],
          });
        }
        try {
          record = await this.channelLocks.beginLock(
            pending.guildId, pending.channelId,
            pending.actorId, pending.reason, snapshot,
          );
        } catch (error) {
          this.logger.error('Failed to reserve channel lock case', error);
          return interaction.editReply({
            content: 'No change attempted: could not save lock audit.',
            components: [],
          });
        }
        if (!record) {
          return interaction.editReply({
            content: 'A Yuugen lock is already active or pending. No change.',
            components: [],
          });
        }
      } else {
        try {
          record = await this.channelLocks.getActive(
            pending.guildId, pending.channelId,
          );
        } catch (error) {
          this.logger.error('Cannot inspect lock before unlock', error);
          return interaction.editReply({
            content: 'Could not verify lock audit. No change attempted.',
            components: [],
          });
        }
        if (!record || record.id !== pending.lockId ||
            record.status !== 'locked' ||
            !matchesLockedSnapshot(record, current)) {
          return interaction.editReply({
            content: 'Lock state or permissions changed. ' +
              'Refusing to override staff changes; use /mod lockstatus.',
            components: [],
          });
        }
        try {
          record = await this.channelLocks.beginUnlock(
            pending.guildId, record.id, pending.actorId, pending.reason,
          );
        } catch (error) {
          this.logger.error('Could not reserve unlock case', error);
          return interaction.editReply({
            content: 'No change attempted: could not save unlock audit.',
            components: [],
          });
        }
        if (!record) {
          return interaction.editReply({
            content: 'Another moderator is already unlocking this channel.',
            components: [],
          });
        }
      }

      const auditReason = (
        'Yuugen lock #' + record.id + ', moderator ' +
        pending.actorId + ': ' + pending.reason
      ).slice(0, 512);
      try {
        if (action === 'lock') {
          await channel.permissionOverwrites.edit(
            interaction.guild.roles.everyone,
            { SendMessages: false },
            { reason: auditReason },
          );
        } else if (!record.originalExisted) {
          // Delete ONLY the overwrite that Yuugen created. The exact
          // bitfield snapshot was verified above before this operation.
          await channel.permissionOverwrites.delete(
            interaction.guild.roles.everyone.id,
            auditReason,
          );
        } else {
          // Edits ONLY SendMessages, preserving unrelated permission bits.
          await channel.permissionOverwrites.edit(
            interaction.guild.roles.everyone,
            { SendMessages: originalSendOverride(record) },
            { reason: auditReason },
          );
        }
      } catch (error) {
        const e = error && typeof error === 'object'
          ? error as { status?: unknown; code?: unknown } : {};
        const definitive = e.status === 403 ||
          e.code === 50013 || e.code === 50001;
        let finalized = false;
        if (definitive) {
          try {
            const updated = action === 'lock'
              ? await this.channelLocks.finishLock(pending.guildId, record.id, 'failed')
              : await this.channelLocks.finishUnlock(pending.guildId, record.id, 'locked');
            finalized = !!updated;
          } catch (saveError) {
            this.logger.error('Could not finalize rejected lock change', saveError);
          }
        }
        this.logger.warn(
          'Lock #' + record.id + (definitive ? ' rejected' : ' outcome uncertain'),
        );
        return interaction.editReply({
          content: finalized
            ? 'Discord denied this channel change; audit #' + record.id +
              ' records the rejection.'
            : 'Channel permission outcome uncertain. Audit #' + record.id +
              ' remains pending. Verify Discord permissions and reconcile manually.',
          components: [],
        });
      }

      let finalized = false;
      try {
        const updated = action === 'lock'
          ? await this.channelLocks.finishLock(pending.guildId, record.id, 'locked')
          : await this.channelLocks.finishUnlock(pending.guildId, record.id, 'unlocked');
        finalized = !!updated;
      } catch (error) {
        this.logger.error('Channel updated but lock audit finalization failed', error);
      }
      if (!finalized) {
        return interaction.editReply({
          content: 'Discord changed the channel, but audit #' + record.id +
            ' is still pending. Staff must reconcile it manually.',
          components: [],
        });
      }
      return interaction.editReply({
        content: 'Channel <#' + pending.channelId + '> ' +
          (action === 'lock' ? 'locked' : 'unlocked') +
          '. Audit case #' + record.id + ' updated.' +
          (action === 'lock'
            ? ' Explicit role allowances and Administrators may still post.'
            : ' Only the saved @everyone permission was restored.'),
        components: [],
        allowedMentions: { parse: [] },
      });
    } finally {
      this.changingChannels.delete(pending.channelId);
    }
  }

  @Button('mod-channel-lock-confirm')
  public async onLockConfirm(@Context() [interaction]: ButtonContext) {
    return this.confirmChannelLock(interaction, 'lock');
  }

  @Button('mod-channel-unlock-confirm')
  public async onUnlockConfirm(@Context() [interaction]: ButtonContext) {
    return this.confirmChannelLock(interaction, 'unlock');
  }

  @Subcommand({
    name: 'cases',
    description: 'Show recent guild moderation cases'
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
        const expectedEnd = item.expiresAt &&
          (item.action === 'timeout' || item.action === 'timeout_pending')
          ? Math.floor(new Date(item.expiresAt).getTime() / 1000)
          : null;
        const expiry = expectedEnd !== null && Number.isFinite(expectedEnd)
          ? '\nIntended end: <t:' + expectedEnd + ':f>' +
            (item.action === 'timeout_pending' ? ' (outcome unconfirmed)' : '')
          : '';
        return '#' + item.id + ' ' + state + ' · ' + when +
          ' · <@' + item.moderatorUserId + '>\n' +
          escapeMarkdown(detail) + expiry;
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
