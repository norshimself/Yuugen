import {
  DEFAULT_ANTI_RAID_CONFIG, isAntiRaidExempt, shouldAlertOnJoin,
  validateAntiRaidConfig, type AntiRaidConfig, type AntiRaidJoin,
} from './anti-raid-policy';

describe('Anti-raid opt-in safety policy', () => {
  const config: AntiRaidConfig = {
    ...DEFAULT_ANTI_RAID_CONFIG, enabled: true,
    alertChannelId: '123456789012345678',
    exemptUserIds: [], exemptRoleIds: [],
  };
  const at = Date.UTC(2026, 9, 28, 12);
  const join: AntiRaidJoin = {
    userId: '234567890123456789', roleIds: [],
    joinedAtMs: at, accountCreatedAtMs: at - 10 * 60000,
    observedAtMs: at + 500,
  };

  it('defaults to disabled, alert-only and with no channel', () => {
    expect(DEFAULT_ANTI_RAID_CONFIG.enabled).toBe(false);
    expect(DEFAULT_ANTI_RAID_CONFIG.mode).toBe('alert_only');
    expect(DEFAULT_ANTI_RAID_CONFIG.alertChannelId).toBeNull();
    expect(shouldAlertOnJoin(DEFAULT_ANTI_RAID_CONFIG, join, 20)).toBe(false);
  });

  it('requires a real channel before enabling and disallows unreviewed actions', () => {
    expect(validateAntiRaidConfig(config)).toBeNull();
    expect(validateAntiRaidConfig({ ...config, alertChannelId: null }))
      .toContain('alert channel');
    expect(validateAntiRaidConfig({ ...config, mode: 'quarantine' }))
      .toContain('alert_only');
    expect(validateAntiRaidConfig({ ...config, mode: 'ban' }))
      .toContain('alert_only');
    expect(validateAntiRaidConfig({ ...config, enabled: 'true' }))
      .toContain('enabled');
    expect(validateAntiRaidConfig({ ...config, arbitrary: true }))
      .toContain('Unknown');
  });

  it('enforces window, age and threshold boundaries', () => {
    expect(shouldAlertOnJoin(config, join, 9)).toBe(false);
    expect(shouldAlertOnJoin(config, join, 10)).toBe(true);
    expect(shouldAlertOnJoin(config, {
      ...join, accountCreatedAtMs: at - 1440 * 60000,
    }, 10)).toBe(false);
    expect(shouldAlertOnJoin(config, {
      ...join, accountCreatedAtMs: at - 1439 * 60000,
    }, 10)).toBe(true);
    expect(shouldAlertOnJoin({ ...config, minAccountAgeMinutes: 0 }, {
      ...join, accountCreatedAtMs: at - 90 * 24 * 3600000,
    }, 10)).toBe(true);
  });

  it('ignores replayed/stale, future and untrusted timestamps', () => {
    expect(shouldAlertOnJoin(config, { ...join, observedAtMs: at + 30001 }, 10)).toBe(false);
    expect(shouldAlertOnJoin(config, { ...join, joinedAtMs: at + 4000 }, 10)).toBe(false);
    expect(shouldAlertOnJoin(config, { ...join, accountCreatedAtMs: at + 100 }, 10)).toBe(false);
    expect(shouldAlertOnJoin(config, { ...join, joinedAtMs: Number.NaN }, 10)).toBe(false);
  });

  it('exempts trusted IDs and roles before even counting joins', () => {
    expect(isAntiRaidExempt({ ...config, exemptUserIds: [join.userId] }, join.userId, []))
      .toBe(true);
    expect(isAntiRaidExempt({ ...config, exemptRoleIds: ['345678901234567890'] },
      join.userId, ['345678901234567890'])).toBe(true);
    expect(shouldAlertOnJoin({ ...config, exemptUserIds: [join.userId] }, join, 100))
      .toBe(false);
    expect(shouldAlertOnJoin({ ...config, exemptRoleIds: ['345678901234567890'] },
      { ...join, roleIds: ['345678901234567890'] }, 100)).toBe(false);
  });

  it('bounds all options and rejects malformed exemption IDs', () => {
    expect(validateAntiRaidConfig({ ...config, threshold: 2 })).toContain('Threshold');
    expect(validateAntiRaidConfig({ ...config, threshold: 101 })).toContain('Threshold');
    expect(validateAntiRaidConfig({ ...config, windowSeconds: 601 })).toContain('Window');
    expect(validateAntiRaidConfig({ ...config, minAccountAgeMinutes: -1 })).toContain('age');
    expect(validateAntiRaidConfig({ ...config, exemptUserIds: ['oops'] })).toContain('user');
    expect(validateAntiRaidConfig({ ...config, exemptRoleIds: Array(51).fill('345678901234567890') }))
      .toContain('role');
    expect(validateAntiRaidConfig(null)).toContain('object');
  });
});
