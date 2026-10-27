import { getKickDenial, KickPolicyInput } from './kick-policy';

describe('kick permission policy', () => {
  const valid: KickPolicyInput = {
    actorId: '123456789012345678',
    targetId: '234567890123456789',
    guildOwnerId: '345678901234567890',
    actorHasKickMembers: true,
    targetIsMember: true,
    targetIsBot: false,
    actorRoleAboveTarget: true,
    botHasKickMembers: true,
    targetKickable: true,
  };

  it('allows staff to kick a lower-ranked member if Yuugen can also kick', () => {
    expect(getKickDenial(valid)).toBeNull();
  });

  it('rejects actors who lack Kick Members', () => {
    expect(getKickDenial({ ...valid, actorHasKickMembers: false }))
      .toContain('Kick Members');
  });

  it('rejects self-kicks, bots, departed members and guild owner', () => {
    expect(getKickDenial({ ...valid, targetId: valid.actorId }))
      .toContain('yourself');
    expect(getKickDenial({ ...valid, targetIsBot: true }))
      .toContain('Bots');
    expect(getKickDenial({ ...valid, targetIsMember: false }))
      .toContain('currently');
    expect(getKickDenial({ ...valid, targetId: valid.guildOwnerId }))
      .toContain('server owner');
  });

  it('requires actor role superiority except for the guild owner', () => {
    expect(getKickDenial({ ...valid, actorRoleAboveTarget: false }))
      .toContain('highest role');
    expect(getKickDenial({
      ...valid,
      actorId: valid.guildOwnerId,
      actorRoleAboveTarget: false,
    })).toBeNull();
  });

  it('requires the bot permission and hierarchy independently', () => {
    expect(getKickDenial({ ...valid, botHasKickMembers: false }))
      .toContain('Yuugen needs');
    expect(getKickDenial({ ...valid, targetKickable: false }))
      .toContain('Yuugen cannot');
  });
});
