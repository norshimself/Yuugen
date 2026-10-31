import {
  DEFAULT_ANTI_NUKE_CONFIG, classifyAntiNukeAudit, isAntiNukeExempt,
  isRecentAuditEvent, validateAntiNukeConfig, type AntiNukeConfig,
} from './anti-nuke-policy';

describe('Anti-nuke audit policy', () => {
  const base: AntiNukeConfig = {
    ...DEFAULT_ANTI_NUKE_CONFIG, enabled: true,
    alertChannelId: '123456789012345678',
  };

  it('starts disabled and provides alert-only actions', () => {
    expect(DEFAULT_ANTI_NUKE_CONFIG.enabled).toBe(false);
    expect(DEFAULT_ANTI_NUKE_CONFIG.mode).toBe('alert_only');
    expect(DEFAULT_ANTI_NUKE_CONFIG.alertChannelId).toBeNull();
    expect(validateAntiNukeConfig(base)).toBeNull();
    expect(validateAntiNukeConfig({ ...base, mode: 'lockdown' })).toContain('alert_only');
    expect(validateAntiNukeConfig({ ...base, mode: 'ban' })).toContain('alert_only');
  });

  it('classifies only actual deletion audit actions, not creations', () => {
    expect(classifyAntiNukeAudit('channel_delete')).toBe('channel_delete');
    expect(classifyAntiNukeAudit('role_delete')).toBe('role_delete');
    expect(classifyAntiNukeAudit('webhook_delete')).toBe('webhook_delete');
    expect(classifyAntiNukeAudit('channel_delete', [
      { key: 'name', old: 'a', new: 'b' },
    ])).toBe('channel_delete');
  });

  it('detects privileged role bit grants, but not harmless role changes', () => {
    expect(classifyAntiNukeAudit('role_update', [
      { key: 'permissions', old: '0', new: '8' },
    ])).toBe('permission_escalation'); // Administrator
    expect(classifyAntiNukeAudit('role_update', [
      { key: 'permissions', old: '0', new: '268435456' },
    ])).toBe('permission_escalation'); // ManageRoles
    expect(classifyAntiNukeAudit('role_update', [
      { key: 'permissions', old: '8', new: '0' },
    ])).toBeNull();
    expect(classifyAntiNukeAudit('role_update', [
      { key: 'permissions', old: '0', new: '1024' },
    ])).toBeNull(); // View Channel is not counted as critical privilege
    expect(classifyAntiNukeAudit('role_update', [
      { key: 'name', old: 'old', new: 'new' },
    ])).toBeNull();
  });

  it('counts channel overwrite privilege gains and removal of critical denies', () => {
    expect(classifyAntiNukeAudit('channel_overwrite_create', [
      { key: 'allow', new: '536870912' },
    ])).toBe('permission_escalation');
    expect(classifyAntiNukeAudit('channel_overwrite_update', [
      { key: 'allow', old: '0', new: '536870912' },
    ])).toBe('permission_escalation');
    expect(classifyAntiNukeAudit('channel_overwrite_update', [
      { key: 'deny', old: '536870912', new: '0' },
    ])).toBe('permission_escalation');
    expect(classifyAntiNukeAudit('channel_overwrite_update', [
      { key: 'deny', old: '0', new: '536870912' },
    ])).toBeNull();
  });

  it('refuses ambiguous audit-log changes without guessing', () => {
    expect(classifyAntiNukeAudit('role_update', [
      { key: 'permissions', new: '8' },
    ])).toBeNull();
    expect(classifyAntiNukeAudit('role_update', [
      { key: 'permissions', old: '0', new: '8' },
      { key: 'permissions', old: '0', new: '8' },
    ])).toBeNull();
    expect(classifyAntiNukeAudit('role_update', [
      { key: 'permissions', old: '0', new: '8;DROP TABLE' },
    ])).toBeNull();
    expect(classifyAntiNukeAudit('channel_overwrite_update', [
      { key: 'allow', new: '536870912' },
    ])).toBeNull();
    expect(classifyAntiNukeAudit('channel_overwrite_create', [
      { key: 'allow', new: '1024' },
    ])).toBeNull();
  });

  it('only exempts authenticated audit executors, never missing actor IDs', () => {
    const config = { ...base, exemptActorIds: ['234567890123456789'] };
    expect(isAntiNukeExempt(config, '234567890123456789')).toBe(true);
    expect(isAntiNukeExempt(config, '345678901234567890')).toBe(false);
    expect(isAntiNukeExempt(config, null)).toBe(false);
  });

  it('only accepts recent audit event timestamps', () => {
    const now = Date.UTC(2026, 9, 28);
    expect(isRecentAuditEvent(now - 30000, now)).toBe(true);
    expect(isRecentAuditEvent(now - 30001, now)).toBe(false);
    expect(isRecentAuditEvent(now + 2000, now)).toBe(true);
    expect(isRecentAuditEvent(now + 2001, now)).toBe(false);
    expect(isRecentAuditEvent(Number.NaN, now)).toBe(false);
  });

  it('bounds thresholds, windows, channels and actor lists', () => {
    expect(validateAntiNukeConfig({ ...base, threshold: 2 })).toContain('Threshold');
    expect(validateAntiNukeConfig({ ...base, threshold: 31 })).toContain('Threshold');
    expect(validateAntiNukeConfig({ ...base, windowSeconds: 9 })).toContain('Window');
    expect(validateAntiNukeConfig({ ...base, windowSeconds: 601 })).toContain('Window');
    expect(validateAntiNukeConfig({ ...base, alertChannelId: null })).toContain('channel');
    expect(validateAntiNukeConfig({ ...base, exemptActorIds: ['fake'] })).toContain('actor');
    expect(validateAntiNukeConfig({
      ...base, exemptActorIds: Array(51).fill('234567890123456789'),
    })).toContain('actor');
    expect(validateAntiNukeConfig({ ...base, enabled: 'true' })).toContain('enabled');
    expect(validateAntiNukeConfig({ ...base, unknownProperty: true })).toContain('Unknown');
  });
});
