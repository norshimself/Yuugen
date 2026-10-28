import { getUnbanDenial, isUnknownBanError, UnbanPolicyInput } from './unban-policy';

describe('Unban permission policy', () => {
  const allowed: UnbanPolicyInput = {
    actorId: '123456789012345678',
    targetId: '234567890123456789',
    guildOwnerId: '345678901234567890',
    actorHasBanMembers: true,
    botHasBanMembers: true,
  };

  it('allows staff and bot with Ban Members', () => {
    expect(getUnbanDenial(allowed)).toBeNull();
  });

  it('rejects actors and bots without Ban Members', () => {
    expect(getUnbanDenial({ ...allowed, actorHasBanMembers: false }))
      .toContain('You need');
    expect(getUnbanDenial({ ...allowed, botHasBanMembers: false }))
      .toContain('Yuugen needs');
  });

  it('rejects malformed, non-snowflake and incorrectly sized user IDs', () => {
    for (const targetId of ['', '123', 'abc234567890123456', '1'.repeat(21)]) {
      expect(getUnbanDenial({ ...allowed, targetId })).toContain('Discord user ID');
    }
  });

  it('rejects self and server-owner IDs', () => {
    expect(getUnbanDenial({ ...allowed, targetId: allowed.actorId }))
      .toContain('yourself');
    expect(getUnbanDenial({ ...allowed, targetId: allowed.guildOwnerId }))
      .toContain('server owner');
  });

  it('only treats Unknown Ban code 10026 as definitely not banned', () => {
    expect(isUnknownBanError({ status: 404, code: 10026 })).toBe(true);
    expect(isUnknownBanError({ code: '10026' })).toBe(true);
    expect(isUnknownBanError({ status: 404, code: 10004 })).toBe(false);
    expect(isUnknownBanError({ status: 404 })).toBe(false);
    expect(isUnknownBanError(new Error('Network timeout'))).toBe(false);
    expect(isUnknownBanError(null)).toBe(false);
  });
});
