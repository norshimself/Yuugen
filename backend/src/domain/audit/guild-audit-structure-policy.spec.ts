import {
  classifyStructuralAudit, isStructuralAuditType, MAX_AUDIT_ENTRY_DELAY_MS,
  sanitizeAuditFieldNames,
} from './guild-audit-structure-policy';
import {
  auditEventKey, formatGuildAudit, validAuditTime, validateGuildAuditConfig,
  type GuildAuditConfig,
} from './guild-audit-policy';

describe('Guild structural audit policy (#61)', () => {
  const enabled: GuildAuditConfig = {
    enabled: true, logChannelId: '123456789012345678',
    selectedEvents: ['role_create', 'member_role_update', 'permission_change'],
    retentionDays: 7,
  };

  it('classifies actual Discord channel, role and webhook create/delete entries', () => {
    for (const kind of [
      'role_create', 'role_delete',
      'channel_create', 'channel_delete',
      'webhook_create', 'webhook_delete',
    ] as const) {
      expect(classifyStructuralAudit(kind, [])).toEqual({
        type: kind, changedFields: [],
      });
    }
  });

  it('classifies selected ordinary updates without copying old/new values', () => {
    expect(classifyStructuralAudit('role_update', [
      { key: 'name', old: 'PRIVATE BEFORE', new: 'PRIVATE AFTER' },
      { key: 'color', old: 1, new: 2 },
    ])).toEqual({ type: 'role_update', changedFields: ['color', 'name'] });
    expect(classifyStructuralAudit('channel_update', [
      { key: 'topic', old: 'PRIVATE TOPIC', new: 'NEW PRIVATE TOPIC' },
    ])).toEqual({ type: 'channel_update', changedFields: ['topic'] });
    expect(classifyStructuralAudit('webhook_update', [
      { key: 'token', old: 'SECRET', new: 'MORE SECRET' },
      { key: 'name', old: 'old', new: 'new' },
    ])).toEqual({ type: 'webhook_update', changedFields: ['name'] });
    expect(classifyStructuralAudit('webhook_update', [
      { key: 'token', old: 'SECRET', new: 'MORE SECRET' },
    ])).toBeNull();
  });

  it('separately classifies role and channel permission changes', () => {
    expect(classifyStructuralAudit('role_update', [
      { key: 'permissions', old: '0', new: '268435456' },
    ])).toEqual({ type: 'permission_change', changedFields: ['permissions'] });
    expect(classifyStructuralAudit('channel_update', [
      { key: 'permission_overwrites', old: [], new: [{ id: 'PRIVATE' }] },
    ])).toEqual({
      type: 'permission_change', changedFields: ['permission_overwrites'],
    });
    expect(classifyStructuralAudit('channel_overwrite_create', [
      { key: 'allow', new: '1024' },
    ])).toEqual({ type: 'permission_change', changedFields: ['allow'] });
    expect(classifyStructuralAudit('channel_overwrite_update', [
      { key: 'deny', old: '8', new: '0' },
    ])).toEqual({ type: 'permission_change', changedFields: ['deny'] });
    expect(classifyStructuralAudit('channel_overwrite_delete', [
      { key: 'allow', old: '8' },
    ])).toEqual({ type: 'permission_change', changedFields: ['allow'] });
  });

  it('ignores malformed, unchanged, missing, or ambiguous permission fields', () => {
    expect(classifyStructuralAudit('role_update', [
      { key: 'permissions', old: '8', new: '8' },
    ])).toBeNull();
    expect(classifyStructuralAudit('role_update', [
      { key: 'permissions', new: '8' },
    ])).toBeNull();
    expect(classifyStructuralAudit('role_update', [
      { key: 'permissions', old: '0', new: '8' },
      { key: 'permissions', old: '0', new: '8' },
    ])).toBeNull();
    expect(classifyStructuralAudit('channel_overwrite_update', [
      { key: 'allow', old: '8', new: 'NaN' },
    ])).toBeNull();
    expect(classifyStructuralAudit('channel_overwrite_update', [
      { key: 'deny', old: '0', new: '0' },
    ])).toBeNull();
    expect(classifyStructuralAudit('channel_update', [])).toBeNull();
  });

  it('records member role updates only with real add/remove audit changes', () => {
    expect(classifyStructuralAudit('member_role_update', [
      { key: '$add', new: [{ id: '234567890123456789', name: 'private' }] },
    ])).toEqual({
      type: 'member_role_update', changedFields: ['roles_added'],
    });
    expect(classifyStructuralAudit('member_role_update', [
      { key: '$remove', old: [{ id: '234567890123456789' }] },
    ])).toEqual({
      type: 'member_role_update', changedFields: ['roles_removed'],
    });
    expect(classifyStructuralAudit('member_role_update', [
      { key: 'nick', new: 'private' },
    ])).toBeNull();
  });

  it('redacts arbitrary field names and never prints values or reason text', () => {
    expect(sanitizeAuditFieldNames([
      'name', 'token', 'password', 'topic', 'name', '__proto__',
    ])).toEqual(['name', 'topic']);
    const summary = formatGuildAudit(
      'webhook_update', '234567890123456789', null,
      '345678901234567890',
      ['name', 'token', 'topic', 'private_secret'],
    );
    expect(summary).toContain('Webhook updated');
    expect(summary).toContain('audit actor ID 345678901234567890');
    expect(summary).toContain('changed: name, topic');
    expect(summary).not.toContain('token');
    expect(summary).not.toContain('private_secret');
    expect(summary).not.toContain('<@');
    expect(formatGuildAudit(
      'message_edit', '234567890123456789', null,
      '345678901234567890', ['name'],
    )).not.toContain('audit actor ID');
  });

  it('accepts 1–30 day retention and rejects arbitrary config or event types', () => {
    expect(validateGuildAuditConfig(enabled)).toBeNull();
    expect(validateGuildAuditConfig({ ...enabled, retentionDays: 1 })).toBeNull();
    expect(validateGuildAuditConfig({ ...enabled, retentionDays: 30 })).toBeNull();
    expect(validateGuildAuditConfig({ ...enabled, retentionDays: 0 })).toContain('Retention');
    expect(validateGuildAuditConfig({ ...enabled, retentionDays: 31 })).toContain('Retention');
    expect(validateGuildAuditConfig({ ...enabled, retentionDays: '7' })).toContain('Retention');
    expect(validateGuildAuditConfig({ ...enabled, selectedEvents: ['not_an_event'] })).toContain('events');
    expect(isStructuralAuditType('permission_change')).toBe(true);
    expect(isStructuralAuditType('message_edit')).toBe(false);
    expect(auditEventKey('permission_change', '234567890123456789', 0))
      .toBe('permission_change:234567890123456789:0');
  });

  it('accepts bounded audit delivery delays but not stale or future events', () => {
    const now = 1800000000000;
    expect(MAX_AUDIT_ENTRY_DELAY_MS).toBe(600000);
    expect(validAuditTime(now - 120001, now)).toBe(false);
    expect(validAuditTime(now - 120001, now, MAX_AUDIT_ENTRY_DELAY_MS)).toBe(true);
    expect(validAuditTime(now - MAX_AUDIT_ENTRY_DELAY_MS - 1, now,
      MAX_AUDIT_ENTRY_DELAY_MS)).toBe(false);
    expect(validAuditTime(now + 5001, now, MAX_AUDIT_ENTRY_DELAY_MS)).toBe(false);
  });
});
