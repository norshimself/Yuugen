/** Passive and opt-in anti-nuke monitoring; this policy never mutates a guild. */
export type AntiNukeKind =
  | 'channel_delete'
  | 'role_delete'
  | 'webhook_delete'
  | 'permission_escalation';

export type ObservedAuditAction =
  | 'channel_delete'
  | 'role_delete'
  | 'webhook_delete'
  | 'role_update'
  | 'channel_overwrite_create'
  | 'channel_overwrite_update';

export interface AntiNukeConfig {
  enabled: boolean;
  mode: 'alert_only';
  threshold: number;
  windowSeconds: number;
  alertChannelId: string | null;
  exemptActorIds: string[];
}

export interface AuditChange {
  key: string;
  old?: unknown;
  new?: unknown;
}

export const DEFAULT_ANTI_NUKE_CONFIG: AntiNukeConfig = {
  enabled: false,
  mode: 'alert_only',
  threshold: 3,
  windowSeconds: 60,
  alertChannelId: null,
  exemptActorIds: [],
};

const snowflake = /^\d{17,20}$/;
// Only escalation of explicitly privileged Discord permission bits counts.
// https://discord.com/developers/docs/topics/permissions#permissions-bitwise-permission-flags
const PRIVILEGED =
  (1n << 1n) |  // Kick Members
  (1n << 2n) |  // Ban Members
  (1n << 3n) |  // Administrator
  (1n << 4n) |  // Manage Channels
  (1n << 5n) |  // Manage Guild
  (1n << 13n) | // Manage Messages
  (1n << 28n) | // Manage Roles
  (1n << 29n) | // Manage Webhooks
  (1n << 40n);  // Moderate Members

/** Strict decimal only: neither JS numbers nor arbitrary text are trusted. */
function readBits(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,38})$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function oneChange(changes: readonly AuditChange[], key: string): AuditChange | null {
  const found = changes.filter(change => change?.key === key);
  return found.length === 1 ? found[0] : null;
}

/**
 * Only authoritative guild audit-log events are classified. Update events
 * count only if the audit log proves privilege was *added*; harmless role
 * names, colors, permissions reductions and webhook creates are ignored.
 * An ambiguous/malformed audit change is never treated as escalation.
 */
export function classifyAntiNukeAudit(
  action: ObservedAuditAction,
  changes: readonly AuditChange[] = [],
): AntiNukeKind | null {
  if (action === 'channel_delete' || action === 'role_delete' ||
      action === 'webhook_delete') return action;
  if (!Array.isArray(changes) || changes.length > 40) return null;
  if (action === 'role_update') {
    const permission = oneChange(changes, 'permissions');
    const before = readBits(permission?.old);
    const after = readBits(permission?.new);
    if (before === null || after === null) return null;
    return ((after & ~before & PRIVILEGED) !== 0n) ? 'permission_escalation' : null;
  }
  if (action === 'channel_overwrite_create' ||
      action === 'channel_overwrite_update') {
    const allow = oneChange(changes, 'allow');
    const oldAllow = action === 'channel_overwrite_create'
      ? 0n : readBits(allow?.old);
    const newAllow = readBits(allow?.new);
    const allowEscalation = oldAllow !== null && newAllow !== null &&
      ((newAllow & ~oldAllow & PRIVILEGED) !== 0n);
    if (allowEscalation) return 'permission_escalation';
    // Removing an explicit deny can also grant privileges through inherited
    // role permissions. Require both snapshots to avoid a false positive.
    if (action === 'channel_overwrite_update') {
      const deny = oneChange(changes, 'deny');
      const oldDeny = readBits(deny?.old);
      const newDeny = readBits(deny?.new);
      if (oldDeny !== null && newDeny !== null &&
          ((oldDeny & ~newDeny & PRIVILEGED) !== 0n)) {
        return 'permission_escalation';
      }
    }
  }
  return null;
}

export function validateAntiNukeConfig(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 'Anti-nuke settings object is required';
  }
  const settings = input as Partial<AntiNukeConfig>;
  const allowed = [
    'enabled', 'mode', 'threshold', 'windowSeconds',
    'alertChannelId', 'exemptActorIds',
  ];
  if (Object.keys(settings).some(key => !allowed.includes(key))) {
    return 'Unknown anti-nuke setting';
  }
  if (typeof settings.enabled !== 'boolean') return 'Invalid enabled state';
  if (settings.mode !== 'alert_only') return 'Only alert_only mode is supported';
  if (!Number.isSafeInteger(settings.threshold) ||
      settings.threshold! < 3 || settings.threshold! > 30) {
    return 'Threshold must be 3 to 30 events';
  }
  if (!Number.isSafeInteger(settings.windowSeconds) ||
      settings.windowSeconds! < 10 || settings.windowSeconds! > 600) {
    return 'Window must be 10 to 600 seconds';
  }
  if (settings.alertChannelId !== null &&
      (typeof settings.alertChannelId !== 'string' ||
       !snowflake.test(settings.alertChannelId))) {
    return 'Invalid alert channel ID';
  }
  if (settings.enabled && !settings.alertChannelId) {
    return 'An alert channel is required before enabling anti-nuke';
  }
  if (!Array.isArray(settings.exemptActorIds) ||
      settings.exemptActorIds.length > 50 ||
      settings.exemptActorIds.some(id => typeof id !== 'string' || !snowflake.test(id))) {
    return 'Invalid exempt actor IDs';
  }
  return null;
}

/** Do not guess an actor when an audit entry lacks executorId. */
export function isAntiNukeExempt(config: AntiNukeConfig, actorId: string | null): boolean {
  return !!actorId && config.exemptActorIds.includes(actorId);
}

export function isRecentAuditEvent(eventAtMs: number, observedAtMs: number): boolean {
  return Number.isSafeInteger(eventAtMs) &&
    Number.isSafeInteger(observedAtMs) &&
    eventAtMs <= observedAtMs + 2_000 &&
    eventAtMs >= observedAtMs - 30_000;
}
