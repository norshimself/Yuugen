import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogEvent, ChannelType, PermissionFlagsBits } from 'discord.js';
import { Context, On } from 'necord';
import type { ContextOf } from 'necord';
import { AntiNukeService } from '../../domain/security/anti-nuke.service';
import {
  classifyAntiNukeAudit, type ObservedAuditAction, type AuditChange,
} from '../../domain/security/anti-nuke-policy';

/** Translate only events whose semantics are actually exposed by Discord. */
function knownAuditAction(value: AuditLogEvent): ObservedAuditAction | null {
  switch (value) {
    case AuditLogEvent.ChannelDelete: return 'channel_delete';
    case AuditLogEvent.RoleDelete: return 'role_delete';
    case AuditLogEvent.WebhookDelete: return 'webhook_delete';
    case AuditLogEvent.RoleUpdate: return 'role_update';
    case AuditLogEvent.ChannelOverwriteCreate: return 'channel_overwrite_create';
    case AuditLogEvent.ChannelOverwriteUpdate: return 'channel_overwrite_update';
    default: return null;
  }
}

/**
 * Audit-log entries have their own unique IDs and an executor ID when Discord
 * supplies one. We never infer an actor by matching gateway timestamps.
 * This listener is read-only except for a rate-limited staff alert.
 */
@Injectable()
export class AntiNukeListener {
  private readonly logger = new Logger(AntiNukeListener.name);
  constructor(
    private readonly antiNuke: AntiNukeService,
    private readonly config: ConfigService,
  ) {}

  @On('guildAuditLogEntryCreate')
  async onAudit(@Context() [entry, guild]: ContextOf<'guildAuditLogEntryCreate'>): Promise<void> {
    if (this.config.get<string>('ENABLE_GUILD_MODERATION_INTENT') !== 'true') return;
    const action = knownAuditAction(entry.action);
    if (!action || !guild?.id) return;
    try {
      const settings = await this.antiNuke.getConfig(guild.id);
      if (!settings.enabled) return;

      // Do not assume access to audit logs from a gateway event alone.
      const bot = guild.members.me || await guild.members.fetchMe().catch(() => null);
      if (!bot || !bot.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
        this.logger.warn('Anti-nuke disabled for this event: View Audit Log missing');
        return;
      }
      const changes: AuditChange[] = (entry.changes || []).map(change => ({
        key: String(change.key), old: change.old, new: change.new,
      }));
      const kind = classifyAntiNukeAudit(action, changes);
      if (!kind) return;
      const alert = await this.antiNuke.observe({
        guildId: guild.id,
        auditEntryId: entry.id,
        kind,
        actorId: entry.executorId || null,
        targetId: entry.targetId || null,
        eventAtMs: entry.createdTimestamp,
        observedAtMs: Date.now(),
      });
      if (!alert) return;

      const channel = await guild.channels.fetch(alert.alertChannelId).catch(() => null);
      const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText || !me ||
          !channel.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel) ||
          !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
        await this.antiNuke.finishAlert(alert.guildId, alert.alertId, 'missing_permissions');
        this.logger.warn('Anti-nuke alert could not be sent (missing channel/permissions)');
        return;
      }
      // No executor, target, or other user IDs in public messages. The
      // manager-only alert history retains limited metadata for review.
      await channel.send({
        content:
          'Anti-nuke staff review: ' + alert.eventCount +
          ' privileged/deletion audit events in ' + alert.windowSeconds +
          ' seconds. Latest type: ' + alert.triggeredBy +
          '. No emergency lockdown or member punishment was applied. Review the guild audit log.',
        allowedMentions: { parse: [] },
      });
      await this.antiNuke.finishAlert(alert.guildId, alert.alertId, 'sent');
    } catch (error) {
      // A Discord send may already have succeeded; never automatically retry.
      this.logger.warn('Anti-nuke monitoring failed (no automatic action)', error);
    }
  }
}
