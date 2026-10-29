/**
 * Pure classifier for authoritative Discord guild audit-log entries.
 * Never store raw audit-log changes (names, reasons, webhook tokens,
 * permission snapshots or any potentially private field values).
 */
export const STRUCTURAL_AUDIT_TYPES = [
  'role_create', 'role_update', 'role_delete',
  'member_role_update',
  'channel_create', 'channel_update', 'channel_delete',
  'webhook_create', 'webhook_update', 'webhook_delete',
  'permission_change',
] as const;
export type StructuralAuditType = (typeof STRUCTURAL_AUDIT_TYPES)[number];

export type StructuralAuditAction =
  | 'role_create' | 'role_update' | 'role_delete'
  | 'member_role_update'
  | 'channel_create' | 'channel_update' | 'channel_delete'
  | 'webhook_create' | 'webhook_update' | 'webhook_delete'
  | 'channel_overwrite_create' | 'channel_overwrite_update'
  | 'channel_overwrite_delete';

export interface AuditLogChangeSummary {
  key: string;
  old?: unknown;
  new?: unknown;
}

export interface StructuralAuditMatch {
  type: StructuralAuditType;
  changedFields: string[];
}

const structuralTypes: ReadonlySet<string> = new Set(STRUCTURAL_AUDIT_TYPES);
export function isStructuralAuditType(type: string): type is StructuralAuditType {
  return structuralTypes.has(type);
}

// Only fixed, human-reviewable field NAMES; never untrusted field values.
const fields = new Map<string, string>([
  ['name', 'name'],
  ['permissions', 'permissions'],
  ['permission_overwrites', 'permission_overwrites'],
  ['allow', 'allow'],
  ['deny', 'deny'],
  ['$add', 'roles_added'],
  ['$remove', 'roles_removed'],
  ['type', 'type'],
  ['topic', 'topic'],
  ['nsfw', 'nsfw'],
  ['parent_id', 'parent_id'],
  ['position', 'position'],
  ['rate_limit_per_user', 'slowmode'],
  ['default_auto_archive_duration', 'thread_archive_duration'],
  ['bitrate', 'bitrate'],
  ['user_limit', 'user_limit'],
  ['hoist', 'hoist'],
  ['mentionable', 'mentionable'],
  ['color', 'color'],
  ['avatar', 'avatar'],
  ['channel_id', 'channel_id'],
]);
const outputFields: ReadonlySet<string> = new Set(fields.values());

/** A stable, bounded set of known labels safe to persist and display. */
export function sanitizeAuditFieldNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 40).filter((name): name is string =>
    typeof name === 'string' && outputFields.has(name)))].sort().slice(0, 12);
}

function changedFields(changes: readonly AuditLogChangeSummary[]): string[] {
  const labels = changes.map(change =>
    change && typeof change.key === 'string'
      ? fields.get(change.key) : undefined).filter((name): name is string => !!name);
  return sanitizeAuditFieldNames(labels);
}

/** Discord audit permission bitfields are decimal strings, not JS numbers. */
function permissionBits(raw: unknown): bigint | null {
  if (typeof raw !== 'string' || !/^(0|[1-9]\d{0,38})$/.test(raw)) return null;
  try {
    const bits = BigInt(raw);
    return bits <= (1n << 64n) - 1n ? bits : null;
  } catch {
    return null;
  }
}

function hasPermissionDelta(
  changes: readonly AuditLogChangeSummary[], key: 'permissions' | 'allow' | 'deny',
  action: 'update' | 'create' | 'delete',
): boolean {
  const matches = changes.filter(change => change?.key === key);
  if (matches.length !== 1) return false;
  const change = matches[0];
  const before = action === 'create' ? 0n : permissionBits(change.old);
  const after = action === 'delete' ? 0n : permissionBits(change.new);
  return before !== null && after !== null && before !== after;
}

/**
 * A trusted audit event can be delayed/out of order. Only classify events
 * backed by the correct Discord action and relevant change keys. No gateway
 * actor inference, no arbitrary regular expressions and no content parsing.
 */
export function classifyStructuralAudit(
  action: StructuralAuditAction,
  rawChanges: unknown,
): StructuralAuditMatch | null {
  const changes: AuditLogChangeSummary[] =
    Array.isArray(rawChanges) && rawChanges.length <= 40 ? rawChanges : [];
  const names = changedFields(changes);
  switch (action) {
    case 'role_create':
    case 'role_delete':
    case 'channel_create':
    case 'channel_delete':
    case 'webhook_create':
    case 'webhook_delete':
      return { type: action, changedFields: names };
    case 'role_update':
      if (hasPermissionDelta(changes, 'permissions', 'update')) {
        return { type: 'permission_change', changedFields: ['permissions'] };
      }
      return names.some(name => name !== 'permissions')
        ? { type: 'role_update', changedFields: names.filter(name => name !== 'permissions') }
        : null;
    case 'channel_update':
      if (names.includes('permission_overwrites') &&
          changes.some(change => change?.key === 'permission_overwrites' &&
            change.old !== undefined && change.new !== undefined)) {
        return { type: 'permission_change', changedFields: ['permission_overwrites'] };
      }
      return names.length ? { type: 'channel_update', changedFields: names } : null;
    case 'webhook_update':
      return names.length ? { type: 'webhook_update', changedFields: names } : null;
    case 'member_role_update': {
      const roleChanges = changes.filter(change =>
        (change?.key === '$add' || change?.key === '$remove') &&
        Array.isArray(change.new) && change.new.length > 0);
      return roleChanges.length
        ? { type: 'member_role_update', changedFields: changedFields(roleChanges) }
        : null;
    }
    case 'channel_overwrite_create':
    case 'channel_overwrite_update':
    case 'channel_overwrite_delete': {
      const mode = action === 'channel_overwrite_create' ? 'create'
        : action === 'channel_overwrite_delete' ? 'delete' : 'update';
      const permissionFields = (['allow', 'deny'] as const)
        .filter(key => hasPermissionDelta(changes, key, mode));
      return permissionFields.length
        ? { type: 'permission_change', changedFields: [...permissionFields] }
        : null;
    }
  }
}

/** Up to ten minutes for a delayed audit-log gateway entry, never older. */
export const MAX_AUDIT_ENTRY_DELAY_MS = 10 * 60_000;
