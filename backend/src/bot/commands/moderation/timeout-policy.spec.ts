import {
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  parseTimeoutDuration,
  formatTimeoutDuration,
  getTimeoutDenial,
  isDefinitiveTimeoutRejection,
  TimeoutPolicyInput,
} from './timeout-policy';

describe('timeout policy and durations', () => {
  const input: TimeoutPolicyInput = {
    action: 'timeout',
    actorId: '123456789012345678',
    targetId: '234567890123456789',
    guildOwnerId: '345678901234567890',
    actorHasModerateMembers: true,
    botHasModerateMembers: true,
    targetIsMember: true,
    targetIsBot: false,
    actorRoleAboveTarget: true,
    targetModeratable: true,
    currentlyTimedOut: false,
  };

  it('parses bounded minute/hour/day durations', () => {
    expect(parseTimeoutDuration('1m')).toBe(MIN_TIMEOUT_MS);
    expect(parseTimeoutDuration('10m')).toBe(600_000);
    expect(parseTimeoutDuration('2h')).toBe(7_200_000);
    expect(parseTimeoutDuration('7d')).toBe(604_800_000);
    expect(parseTimeoutDuration(' 28D ')).toBe(MAX_TIMEOUT_MS);
    expect(parseTimeoutDuration('672h')).toBe(MAX_TIMEOUT_MS);
    expect(parseTimeoutDuration('40320m')).toBe(MAX_TIMEOUT_MS);
  });

  it('rejects empty, negative, fractional, huge and unsupported units', () => {
    for (const value of ['', '0m', '-1m', '0.5h', '29d',
      '673h', '40321m', '1w', '1s', '100000m', '1 m', 'nan',
      'Infinity', null, undefined, 60_000]) {
      expect(parseTimeoutDuration(value)).toBeNull();
    }
  });

  it('formats timeouts for readable confirmation', () => {
    expect(formatTimeoutDuration(60_000)).toBe('1 minute');
    expect(formatTimeoutDuration(2 * 3_600_000)).toBe('2 hours');
    expect(formatTimeoutDuration(28 * 86_400_000)).toBe('28 days');
  });

  it('allows action when staff and bot can moderate target', () => {
    expect(getTimeoutDenial(input)).toBeNull();
    expect(getTimeoutDenial({
      ...input,
      action: 'untimeout',
      currentlyTimedOut: true,
    })).toBeNull();
  });

  it('requires human and bot Moderate Members permissions separately', () => {
    expect(getTimeoutDenial({
      ...input,
      actorHasModerateMembers: false,
    })).toContain('You need');
    expect(getTimeoutDenial({
      ...input,
      botHasModerateMembers: false,
    })).toContain('Yuugen needs');
  });

  it('protects self, bots, nonmembers, and the guild owner', () => {
    expect(getTimeoutDenial({
      ...input,
      targetId: input.actorId,
    })).toContain('yourself');
    expect(getTimeoutDenial({
      ...input,
      targetIsBot: true,
    })).toContain('Bots');
    expect(getTimeoutDenial({
      ...input,
      targetIsMember: false,
    })).toContain('currently');
    expect(getTimeoutDenial({
      ...input,
      targetId: input.guildOwnerId,
    })).toContain('owner');
  });

  it('enforces actor and bot role hierarchy, even for owner moderators', () => {
    expect(getTimeoutDenial({
      ...input,
      actorRoleAboveTarget: false,
    })).toContain('highest role');
    expect(getTimeoutDenial({
      ...input,
      targetModeratable: false,
    })).toContain('Yuugen cannot');
    expect(getTimeoutDenial({
      ...input,
      actorId: input.guildOwnerId,
      actorRoleAboveTarget: false,
    })).toBeNull();
    expect(getTimeoutDenial({
      ...input,
      actorId: input.guildOwnerId,
      actorRoleAboveTarget: false,
      targetModeratable: false,
    })).toContain('Yuugen cannot');
  });

  it('rejects reapplying an active timeout and removing a missing one', () => {
    expect(getTimeoutDenial({
      ...input,
      currentlyTimedOut: true,
    })).toContain('already timed out');
    expect(getTimeoutDenial({
      ...input,
      action: 'untimeout',
    })).toContain('not currently timed out');
  });

  it('does not classify generic 404 or transport failures as definitive', () => {
    expect(isDefinitiveTimeoutRejection({ status: 403, code: 50013 })).toBe(true);
    expect(isDefinitiveTimeoutRejection({ status: 404, code: 10007 })).toBe(true);
    expect(isDefinitiveTimeoutRejection({ code: '10007' })).toBe(true);
    expect(isDefinitiveTimeoutRejection({ status: 404 })).toBe(false);
    expect(isDefinitiveTimeoutRejection(new Error('Timeout'))).toBe(false);
    expect(isDefinitiveTimeoutRejection(null)).toBe(false);
  });
});
