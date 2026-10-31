/**
 * Guild audit is opt-in. We deliberately never retain message bodies,
 * attachments, author names or user-provided free-form text.
 */
export const AUDIT_TYPES = [
  'message_edit', 'message_delete',
  'member_join', 'member_departure', 'member_ban',
  'member_kick', 'member_timeout',
] as const;
export type GuildAuditType = (typeof AUDIT_TYPES)[number];

export interface GuildAuditConfig {
  enabled: boolean;
  logChannelId: string | null;
  selectedEvents: GuildAuditType[];
}

export const DEFAULT_GUILD_AUDIT: GuildAuditConfig = {
  enabled: false,
  logChannelId: null,
  selectedEvents: [],
};

const snowflake = /^\d{17,20}$/;
const types: ReadonlySet<string> = new Set(AUDIT_TYPES);

/** Reject unexpected keys rather than passing arbitrary entity fields to TypeORM. */
export function validateGuildAuditConfig(input: unknown): string | null {
  if (!input || Array.isArray(input) || typeof input !== 'object') {
    return 'Audit settings object is required';
  }
  const value = input as Partial<GuildAuditConfig>;
  if (Object.keys(value).some(key =>
    !['enabled', 'logChannelId', 'selectedEvents'].includes(key))) {
    return 'Unknown audit setting';
  }
  if (typeof value.enabled !== 'boolean') return 'Invalid enabled state';
  if (value.logChannelId !== null &&
      (typeof value.logChannelId !== 'string' || !snowflake.test(value.logChannelId))) {
    return 'Invalid log channel ID';
  }
  if (!Array.isArray(value.selectedEvents) ||
      value.selectedEvents.length > AUDIT_TYPES.length ||
      value.selectedEvents.some(type => typeof type !== 'string' || !types.has(type)) ||
      new Set(value.selectedEvents).size !== value.selectedEvents.length) {
    return 'Invalid selected audit events';
  }
  if (value.enabled && (!value.logChannelId || !value.selectedEvents.length)) {
    return 'Enabled audit requires a log channel and selected events';
  }
  return null;
}

/** Stable replay-safe identity. The revision is a Discord timestamp or time bucket. */
export function auditEventKey(
  type: GuildAuditType, id: string, revision: number,
): string | null {
  if (!types.has(type) || typeof id !== 'string' || !snowflake.test(id) ||
      !Number.isSafeInteger(revision) || revision < 0) return null;
  return type + ':' + id + ':' + revision;
}

/** No arbitrary event timestamp may create a future/very old audit record. */
export function validAuditTime(occurredAtMs: number, observedAtMs: number): boolean {
  return Number.isSafeInteger(occurredAtMs) &&
    Number.isSafeInteger(observedAtMs) &&
    occurredAtMs <= observedAtMs + 5000 &&
    occurredAtMs >= observedAtMs - 120000;
}

/** Guild manager must explicitly select each event kind. */
export function shouldAudit(
  config: GuildAuditConfig, eventType: GuildAuditType,
  sourceChannelId: string | null,
): boolean {
  return config.enabled &&
    config.selectedEvents.includes(eventType) &&
    // Never recursively log the logs channel, including uncached bot messages.
    (!sourceChannelId || sourceChannelId !== config.logChannelId);
}

/**
 * Include only validated, Discord-owned identifiers in staff messages. Never
 * interpolate message content, free-text reasons, usernames, or mentions.
 */
export function formatGuildAudit(
  type: GuildAuditType,
  targetId: string | null,
  sourceChannelId: string | null,
  actorId: string | null,
): string {
  const label: Record<GuildAuditType, string> = {
    message_edit: 'Message edited',
    message_delete: 'Message deleted',
    member_join: 'Member joined',
    member_departure: 'Member departed (reason unverified)',
    member_ban: 'Member banned (actor unverified)',
    member_kick: 'Member kicked (confirmed by Discord audit log)',
    member_timeout: 'Member timeout changed (actor unverified)',
  };
  const parts = ['Guild audit: ' + label[type]];
  if (targetId && snowflake.test(targetId)) parts.push('target ID ' + targetId);
  if (sourceChannelId && snowflake.test(sourceChannelId)) {
    parts.push('channel ID ' + sourceChannelId);
  }
  if (type === 'member_kick' && actorId && snowflake.test(actorId)) {
    parts.push('audit actor ID ' + actorId);
  }
  return parts.join(' | ') + '. Metadata only; no message contents captured.';
}
