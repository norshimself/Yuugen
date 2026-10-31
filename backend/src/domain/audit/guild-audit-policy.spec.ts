import {
  AUDIT_TYPES, DEFAULT_GUILD_AUDIT, auditEventKey, formatGuildAudit,
  shouldAudit, validAuditTime, validateGuildAuditConfig,
  type GuildAuditConfig,
} from './guild-audit-policy';

describe('metadata-only guild audit policy', () => {
  const config: GuildAuditConfig = {
    enabled: true, logChannelId: '123456789012345678',
    selectedEvents: ['message_edit', 'message_delete', 'member_kick'],
  };

  it('starts disabled, empty and privacy-preserving', () => {
    expect(DEFAULT_GUILD_AUDIT).toEqual({
      enabled: false, logChannelId: null, selectedEvents: [],
      retentionDays: 7,
    });
    expect(AUDIT_TYPES).toContain('member_timeout');
    expect(shouldAudit(DEFAULT_GUILD_AUDIT, 'message_delete', null)).toBe(false);
  });

  it('requires an explicit set of valid selected events and a channel', () => {
    expect(validateGuildAuditConfig(config)).toBeNull();
    expect(validateGuildAuditConfig({ ...config, selectedEvents: [] })).toContain('requires');
    expect(validateGuildAuditConfig({ ...config, logChannelId: null })).toContain('requires');
    expect(validateGuildAuditConfig({ ...config, selectedEvents: ['admin_override'] }))
      .toContain('events');
    expect(validateGuildAuditConfig({ ...config, selectedEvents: ['member_kick', 'member_kick'] }))
      .toContain('events');
    expect(validateGuildAuditConfig({ ...config, enabled: 'true' })).toContain('enabled');
    expect(validateGuildAuditConfig({ ...config, unknown: true })).toContain('Unknown');
    expect(validateGuildAuditConfig(null)).toContain('object');
  });

  it('selects exact event types and avoids logging its own destination', () => {
    expect(shouldAudit(config, 'message_edit', '234567890123456789')).toBe(true);
    expect(shouldAudit(config, 'message_edit', config.logChannelId)).toBe(false);
    expect(shouldAudit(config, 'member_join', null)).toBe(false);
    expect(shouldAudit(config, 'member_kick', null)).toBe(true);
  });

  it('builds stable replay keys and rejects malformed identifiers', () => {
    expect(auditEventKey('message_delete', '234567890123456789', 0))
      .toBe('message_delete:234567890123456789:0');
    expect(auditEventKey('member_kick', '234567890123456789', 0))
      .toBe('member_kick:234567890123456789:0');
    expect(auditEventKey('message_edit', 'bad', 100)).toBeNull();
    expect(auditEventKey('message_edit', '234567890123456789', -1)).toBeNull();
    expect(auditEventKey('message_edit', '234567890123456789', 1.5)).toBeNull();
  });

  it('rejects stale or impossible timestamps with a 2-minute bound', () => {
    const now = 1_800_000_000_000;
    expect(validAuditTime(now, now)).toBe(true);
    expect(validAuditTime(now - 120000, now)).toBe(true);
    expect(validAuditTime(now - 120001, now)).toBe(false);
    expect(validAuditTime(now + 5001, now)).toBe(false);
    expect(validAuditTime(Number.NaN, now)).toBe(false);
  });

  it('never includes arbitrary message content, usernames or unverified actors', () => {
    const result = formatGuildAudit(
      'message_edit', '234567890123456789', '345678901234567890',
      '456789012345678901',
    );
    expect(result).toContain('Message edited');
    expect(result).toContain('234567890123456789');
    expect(result).not.toContain('456789012345678901');
    expect(result).not.toContain('<@');
    expect(formatGuildAudit('member_departure', '234567890123456789', null, null))
      .toContain('reason unverified');
    expect(formatGuildAudit('member_kick', '234567890123456789', null,
      '456789012345678901')).toContain('audit actor ID');
  });
});
