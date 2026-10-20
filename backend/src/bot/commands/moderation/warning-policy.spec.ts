import { getWarningDenial, WarningPolicyInput } from './warning-policy';

describe('Warning permission policy', () => {
  const valid: WarningPolicyInput = {
    actorUserId: '123456789012345678',
    targetUserId: '234567890123456789',
    guildOwnerId: '345678901234567890',
    actorHasModerateMembers: true,
    targetIsBot: false,
    targetIsGuildMember: true,
    actorRoleAboveTarget: true,
  };

  it('allows staff to warn a lower-ranked human member', () => {
    expect(getWarningDenial(valid)).toBeNull();
  });

  it('denies a member without the Moderate Members permission', () => {
    expect(getWarningDenial({
      ...valid,
      actorHasModerateMembers: false,
    })).toContain('Moderate Members');
  });

  it('rejects self-warnings, bots and former members', () => {
    expect(getWarningDenial({ ...valid, targetUserId: valid.actorUserId }))
      .toContain('yourself');
    expect(getWarningDenial({ ...valid, targetIsBot: true }))
      .toContain('Bots');
    expect(getWarningDenial({ ...valid, targetIsGuildMember: false }))
      .toContain('currently');
  });

  it('protects the server owner and higher/equal role hierarchy', () => {
    expect(getWarningDenial({
      ...valid,
      targetUserId: valid.guildOwnerId,
    })).toContain('owner');
    expect(getWarningDenial({
      ...valid,
      actorRoleAboveTarget: false,
    })).toContain('above');
  });

  it('allows the owner to warn a lower-ranked member without a role comparison', () => {
    expect(getWarningDenial({
      ...valid,
      actorUserId: valid.guildOwnerId,
      actorRoleAboveTarget: false,
    })).toBeNull();
  });
});
