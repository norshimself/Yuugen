/** Conservative, opt-in anti-raid policy. No punitive actions are implemented. */
export interface AntiRaidConfig {
  enabled: boolean;
  mode: 'alert_only';
  threshold: number;
  windowSeconds: number;
  minAccountAgeMinutes: number;
  alertChannelId: string | null;
  exemptUserIds: string[];
  exemptRoleIds: string[];
}

export interface AntiRaidJoin {
  joinedAtMs: number;
  accountCreatedAtMs: number;
  observedAtMs: number;
  userId: string;
  roleIds: readonly string[];
}

export const DEFAULT_ANTI_RAID_CONFIG: AntiRaidConfig = {
  enabled: false,
  mode: 'alert_only',
  threshold: 10,
  windowSeconds: 60,
  minAccountAgeMinutes: 1440,
  alertChannelId: null,
  exemptUserIds: [],
  exemptRoleIds: [],
};

const snowflake = /^\d{17,20}$/;
const fields = new Set(Object.keys(DEFAULT_ANTI_RAID_CONFIG));

/** Validate the *entire* write payload; never persist unrecognized properties. */
export function validateAntiRaidConfig(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 'Anti-raid settings object is required';
  }
  const value = input as Partial<AntiRaidConfig>;
  if (Object.keys(value).some(key => !fields.has(key))) {
    return 'Unknown anti-raid setting';
  }
  if (typeof value.enabled !== 'boolean') return 'Invalid enabled setting';
  if (value.mode !== 'alert_only') return 'Only alert_only mode is supported';
  if (!Number.isSafeInteger(value.threshold) ||
      value.threshold! < 3 || value.threshold! > 100) {
    return 'Threshold must be 3 to 100 joins';
  }
  if (!Number.isSafeInteger(value.windowSeconds) ||
      value.windowSeconds! < 10 || value.windowSeconds! > 600) {
    return 'Window must be 10 to 600 seconds';
  }
  if (!Number.isSafeInteger(value.minAccountAgeMinutes) ||
      value.minAccountAgeMinutes! < 0 || value.minAccountAgeMinutes! > 43200) {
    return 'Minimum account age must be 0 to 43200 minutes';
  }
  if (value.alertChannelId !== null &&
      (typeof value.alertChannelId !== 'string' ||
        !snowflake.test(value.alertChannelId))) {
    return 'Invalid alert channel ID';
  }
  if (value.enabled && !value.alertChannelId) {
    return 'An alert channel is required before enabling anti-raid';
  }
  for (const [label, ids] of [
    ['user', value.exemptUserIds],
    ['role', value.exemptRoleIds],
  ] as const) {
    if (!Array.isArray(ids) || ids.length > 50 ||
        ids.some(id => typeof id !== 'string' || !snowflake.test(id))) {
      return 'Invalid exempt ' + label + ' IDs';
    }
  }
  return null;
}

export function isAntiRaidExempt(
  config: AntiRaidConfig,
  userId: string,
  roleIds: readonly string[],
): boolean {
  return config.exemptUserIds.includes(userId) ||
    config.exemptRoleIds.some(id => roleIds.includes(id));
}

/**
 * Only current, trustworthy join events may generate alerts. A join spike is
 * not enough on its own unless staff explicitly sets minAccountAgeMinutes=0.
 * Joining account age is checked at the join time, not current wall clock.
 */
export function shouldAlertOnJoin(
  config: AntiRaidConfig,
  join: AntiRaidJoin,
  joinCount: number,
): boolean {
  if (!config.enabled || config.mode !== 'alert_only' ||
      isAntiRaidExempt(config, join.userId, join.roleIds)) return false;
  if (!Number.isSafeInteger(joinCount) || joinCount < config.threshold) return false;
  const { joinedAtMs, accountCreatedAtMs, observedAtMs } = join;
  if (![joinedAtMs, accountCreatedAtMs, observedAtMs]
    .every(Number.isFinite)) return false;
  if (joinedAtMs > observedAtMs + 2000 ||
      observedAtMs - joinedAtMs > Math.min(config.windowSeconds * 1000, 30000)) {
    return false;
  }
  const accountAge = joinedAtMs - accountCreatedAtMs;
  if (accountAge < 0) return false;
  return config.minAccountAgeMinutes === 0 ||
    accountAge < config.minAccountAgeMinutes * 60000;
}
