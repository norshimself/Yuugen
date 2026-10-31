import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { Context, On } from 'necord';
import type { ContextOf } from 'necord';
import { GuildAuditService } from '../../domain/audit/guild-audit.service';
import { shouldAudit } from '../../domain/audit/guild-audit-policy';
import {
  classifyStructuralAudit, type StructuralAuditAction,
} from '../../domain/audit/guild-audit-structure-policy';
import { GuildAuditListener } from './guild-audit.listener';

const SNOWFLAKE = /^\d{17,20}$/;

function recognizedAction(action: AuditLogEvent): StructuralAuditAction | null {
  switch (action) {
    case AuditLogEvent.RoleCreate: return 'role_create';
    case AuditLogEvent.RoleUpdate: return 'role_update';
    case AuditLogEvent.RoleDelete: return 'role_delete';
    case AuditLogEvent.MemberRoleUpdate: return 'member_role_update';
    case AuditLogEvent.ChannelCreate: return 'channel_create';
    case AuditLogEvent.ChannelUpdate: return 'channel_update';
    case AuditLogEvent.ChannelDelete: return 'channel_delete';
    case AuditLogEvent.WebhookCreate: return 'webhook_create';
    case AuditLogEvent.WebhookUpdate: return 'webhook_update';
    case AuditLogEvent.WebhookDelete: return 'webhook_delete';
    case AuditLogEvent.ChannelOverwriteCreate: return 'channel_overwrite_create';
    case AuditLogEvent.ChannelOverwriteUpdate: return 'channel_overwrite_update';
    case AuditLogEvent.ChannelOverwriteDelete: return 'channel_overwrite_delete';
    default: return null;
  }
}

/**
 * Reads actual Discord guild audit entries only, not correlated gateway
 * updates. Audit reasons, old/new values, usernames and webhook tokens
 * must never be forwarded to the metadata-only persistence layer.
 */
@Injectable()
export class GuildStructureAuditListener {
  private readonly logger = new Logger(GuildStructureAuditListener.name);

  constructor(
    private readonly audits: GuildAuditService,
    private readonly delivery: GuildAuditListener,
    private readonly config: ConfigService,
  ) {}

  @On('guildAuditLogEntryCreate')
  async onAudit(
    @Context() [entry, guild]: ContextOf<'guildAuditLogEntryCreate'>,
  ): Promise<void> {
    if (!guild?.id ||
        this.config.get<string>('ENABLE_GUILD_MODERATION_INTENT') !== 'true' ||
        this.config.get<string>('ENABLE_GUILD_AUDIT_LOGGING') !== 'true') return;
    const action = recognizedAction(entry.action);
    if (!action) return;
    const matched = classifyStructuralAudit(action, entry.changes);
    if (!matched) return;

    // The bot's own changes, such as changing audit-channel permissions,
    // cannot produce recursive alert loops.
    if (entry.executorId && entry.executorId === guild.client.user?.id) return;
    try {
      const targetId = entry.targetId && SNOWFLAKE.test(entry.targetId)
        ? entry.targetId : null;
      const sourceChannelId = action.startsWith('channel_')
        ? targetId : null;
      const settings = await this.audits.getConfig(guild.id);
      if (!shouldAudit(settings, matched.type, sourceChannelId)) return;

      // Discord only sends this event with View Audit Log; recheck at time
      // of handling to fail closed if the bot loses access after dispatch.
      const bot = guild.members.me ||
        await guild.members.fetchMe().catch(() => null);
      if (!bot?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;

      await this.delivery.record({
        guildId: guild.id,
        eventType: matched.type,
        eventId: entry.id,
        revision: 0,
        occurredAtMs: entry.createdTimestamp,
        observedAtMs: Date.now(),
        targetId,
        sourceChannelId,
        actorId: entry.executorId || null,
        changedFields: matched.changedFields,
        verifiedAuditEntry: true,
      });
    } catch (error) {
      this.logger.warn('Structural audit entry skipped (no mutation performed)', error);
    }
  }
}
