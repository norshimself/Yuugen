import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditLogEvent, ChannelType, Client, PermissionFlagsBits,
} from 'discord.js';
import { Context, On } from 'necord';
import type { ContextOf } from 'necord';
import {
  GuildAuditService, type GuildAuditInput,
} from '../../domain/audit/guild-audit.service';
import {
  formatGuildAudit, shouldAudit,
} from '../../domain/audit/guild-audit-policy';

const MINUTE = 60_000;

/**
 * Only trusted gateway metadata is recorded. Never fetch message contents.
 * In particular, a guildMemberRemove event cannot distinguish a voluntary
 * departure from a kick or ban, and is always labeled "departure".
 */
@Injectable()
export class GuildAuditListener {
  private readonly logger = new Logger(GuildAuditListener.name);

  constructor(
    private readonly audit: GuildAuditService,
    private readonly client: Client,
    private readonly config: ConfigService,
  ) {}

  private async record(input: GuildAuditInput): Promise<void> {
    try {
      const item = await this.audit.reserve(input);
      if (!item) return;

      // Re-read the configuration after claiming a slot so a manager's
      // disable or channel change will not deliberately send stale logs.
      const current = await this.audit.getConfig(item.guildId, true);
      if (!shouldAudit(current, item.eventType, item.sourceChannelId) ||
          current.logChannelId !== item.logChannelId) {
        await this.audit.finish(item.guildId, item.id, 'config_changed');
        return;
      }
      const guild = this.client.guilds.cache.get(item.guildId);
      const channel = await guild?.channels.fetch(item.logChannelId)
        .catch(() => null);
      const bot = guild?.members.me ||
        await guild?.members.fetchMe().catch(() => null);
      if (!guild || !bot || !channel || channel.type !== ChannelType.GuildText ||
          !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel) ||
          !channel.permissionsFor(bot)?.has(PermissionFlagsBits.SendMessages) ||
          channel.permissionsFor(guild.roles.everyone)
            ?.has(PermissionFlagsBits.ViewChannel) !== false) {
        await this.audit.finish(item.guildId, item.id, 'missing_permissions');
        this.logger.warn('Guild audit destination unavailable or not private');
        return;
      }
      await channel.send({
        content: formatGuildAudit(
          item.eventType, item.targetId, item.sourceChannelId, item.actorId,
        ),
        allowedMentions: { parse: [] },
      });
      await this.audit.finish(item.guildId, item.id, 'sent');
    } catch (error) {
      // Discord may have received the message before a network timeout;
      // preserve pending status and never automatically retry delivery.
      this.logger.warn('Guild audit failed (no message content saved)', error);
    }
  }

  @On('messageUpdate')
  async onMessageUpdate(
    @Context() [oldMessage, message]: ContextOf<'messageUpdate'>,
  ): Promise<void> {
    // A missing old message is safe: actual edit time is provided by Discord.
    if (!message.guildId || !message.channelId || !message.editedTimestamp ||
        message.author?.bot || message.webhookId) return;
    const now = Date.now();
    await this.record({
      guildId: message.guildId, eventType: 'message_edit',
      eventId: message.id, revision: message.editedTimestamp,
      occurredAtMs: message.editedTimestamp, observedAtMs: now,
      sourceChannelId: message.channelId, targetId: message.id, actorId: null,
    });
  }

  @On('messageDelete')
  async onMessageDelete(
    @Context() [message]: ContextOf<'messageDelete'>,
  ): Promise<void> {
    if (!message.guildId || !message.channelId ||
        message.author?.bot || message.webhookId) return;
    const now = Date.now();
    await this.record({
      guildId: message.guildId, eventType: 'message_delete',
      eventId: message.id, revision: 0,
      occurredAtMs: now, observedAtMs: now,
      sourceChannelId: message.channelId, targetId: message.id, actorId: null,
    });
  }

  @On('guildMemberAdd')
  async onMemberAdd(@Context() [member]: ContextOf<'guildMemberAdd'>): Promise<void> {
    if (this.config.get<string>('ENABLE_GUILD_MEMBERS_INTENT') !== 'true' ||
        member.user.bot) return;
    const now = Date.now();
    await this.record({
      guildId: member.guild.id, eventType: 'member_join',
      eventId: member.id,
      revision: member.joinedTimestamp ?? Math.floor(now / MINUTE),
      occurredAtMs: member.joinedTimestamp ?? now, observedAtMs: now,
      sourceChannelId: null, targetId: member.id, actorId: null,
    });
  }

  @On('guildMemberRemove')
  async onMemberRemove(@Context() [member]: ContextOf<'guildMemberRemove'>): Promise<void> {
    if (this.config.get<string>('ENABLE_GUILD_MEMBERS_INTENT') !== 'true' ||
        member.user?.bot) return;
    const now = Date.now();
    await this.record({
      guildId: member.guild.id, eventType: 'member_departure',
      eventId: member.id,
      revision: member.joinedTimestamp ?? Math.floor(now / MINUTE),
      occurredAtMs: now, observedAtMs: now,
      sourceChannelId: null, targetId: member.id, actorId: null,
    });
  }

  @On('guildMemberUpdate')
  async onMemberUpdate(
    @Context() [before, after]: ContextOf<'guildMemberUpdate'>,
  ): Promise<void> {
    if (this.config.get<string>('ENABLE_GUILD_MEMBERS_INTENT') !== 'true' ||
        after.user.bot) return;
    const oldUntil = before.communicationDisabledUntilTimestamp ?? null;
    const newUntil = after.communicationDisabledUntilTimestamp ?? null;
    if (oldUntil === newUntil) return;
    const now = Date.now();
    await this.record({
      guildId: after.guild.id, eventType: 'member_timeout',
      eventId: after.id,
      revision: newUntil ?? oldUntil ?? Math.floor(now / MINUTE),
      occurredAtMs: now, observedAtMs: now,
      sourceChannelId: null, targetId: after.id, actorId: null,
    });
  }

  @On('guildBanAdd')
  async onBan(@Context() [ban]: ContextOf<'guildBanAdd'>): Promise<void> {
    if (this.config.get<string>('ENABLE_GUILD_MODERATION_INTENT') !== 'true' ||
        ban.user.bot) return;
    const now = Date.now();
    await this.record({
      guildId: ban.guild.id, eventType: 'member_ban',
      eventId: ban.user.id, revision: Math.floor(now / MINUTE),
      occurredAtMs: now, observedAtMs: now,
      sourceChannelId: null, targetId: ban.user.id, actorId: null,
    });
  }

  @On('guildAuditLogEntryCreate')
  async onKickAudit(
    @Context() [entry, guild]: ContextOf<'guildAuditLogEntryCreate'>,
  ): Promise<void> {
    if (this.config.get<string>('ENABLE_GUILD_MODERATION_INTENT') !== 'true' ||
        entry.action !== AuditLogEvent.MemberKick || !guild) return;
    // Kick actor attribution is accepted ONLY from this actual Discord audit
    // entry, not an adjacent guildMemberRemove event.
    const bot = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!bot?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
    await this.record({
      guildId: guild.id, eventType: 'member_kick',
      eventId: entry.id, revision: 0,
      occurredAtMs: entry.createdTimestamp, observedAtMs: Date.now(),
      sourceChannelId: null,
      targetId: entry.targetId || null,
      actorId: entry.executorId || null,
    });
  }
}
