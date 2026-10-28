import { BanPolicyInput, getBanDenial } from './ban-policy';

describe('BanPolicy', () => {
  const input: BanPolicyInput = {
    actorId: '123456789012345678',
    targetId: '234567890123456789',
    guildOwnerId: '345678901234567890',
    actorHasBanMembers: true,
    targetIsMember: true,
    targetIsBot: false,
    actorRoleAboveTarget: true,
    botHasBanMembers: true,
    targetBannable: true,
  };

  it('allows a moderator and bot with sufficient permissions and hierarchy', () => {
    expect(getBanDenial(input)).toBeNull();
  });

  it('denies moderators without Ban Members', () => {
    expect(getBanDenial({ ...input, actorHasBanMembers: false }))
      .toContain('Ban Members');
  });

  it('protects self, bots, departed members, and the owner', () => {
    expect(getBanDenial({ ...input, targetId: input.actorId }))
      .toContain('yourself');
    expect(getBanDenial({ ...input, targetIsBot: true }))
      .toContain('Bots');
    expect(getBanDenial({ ...input, targetIsMember: false }))
      .toContain('currently');
    expect(getBanDenial({ ...input, targetId: input.guildOwnerId }))
      .toContain('server owner');
  });

  it('requires the moderator to outrank the target', () => {
    expect(getBanDenial({ ...input, actorRoleAboveTarget: false }))
      .toContain('highest role');
  });

  it('exempts the guild owner from actor hierarchy, but not bot authority', () => {
    expect(getBanDenial({
      ...input,
      actorId: input.guildOwnerId,
      actorRoleAboveTarget: false,
    })).toBeNull();

    expect(getBanDenial({
      ...input,
      actorId: input.guildOwnerId,
      actorRoleAboveTarget: false,
      botHasBanMembers: false,
    })).toContain('Yuugen needs');
  });

  it('requires separate bot permission and bannability checks', () => {
    expect(getBanDenial({ ...input, botHasBanMembers: false }))
      .toContain('Yuugen needs');
    expect(getBanDenial({ ...input, targetBannable: false }))
      .toContain('Yuugen cannot');
  });
});
