import {
  SEND_MESSAGES_BIT,
  getChannelLockDenial,
  getChannelLockReason,
  makeLockSnapshot,
  matchesLockedSnapshot,
  originalSendOverride,
  readSendState,
} from './channel-lock-policy';

describe('channel lock permissions and snapshots', () => {
  const permissions = {
    actorCanView: true, actorCanManageChannels: true,
    actorCanManageRoles: true, botCanView: true,
    botCanManageChannels: true, botCanManageRoles: true,
  };

  it('requires channel-level rights for both moderator and bot', () => {
    expect(getChannelLockDenial(permissions)).toBeNull();
    for (const key of ['actorCanView', 'actorCanManageChannels',
      'actorCanManageRoles', 'botCanView', 'botCanManageChannels',
      'botCanManageRoles'] as const) {
      expect(getChannelLockDenial({ ...permissions, [key]: false }))
        .toMatch(key.startsWith('actor') ? /You need/ : /Yuugen needs/);
    }
  });

  it('detects inherited, explicit allow and explicit deny states', () => {
    expect(readSendState({ existed: false, allow: '0', deny: '0' }))
      .toBe('inherit');
    expect(readSendState({
      existed: true, allow: SEND_MESSAGES_BIT.toString(), deny: '0',
    })).toBe('allow');
    expect(readSendState({
      existed: true, allow: '0', deny: SEND_MESSAGES_BIT.toString(),
    })).toBe('deny');
  });

  it('changes only the send bit and keeps unrelated permission flags', () => {
    const send = SEND_MESSAGES_BIT;
    const allow = send | 8n;
    const deny = 16n;
    const locked = makeLockSnapshot({
      existed: true, allow: allow.toString(), deny: deny.toString(),
    });
    expect(locked).toEqual({
      originalExisted: true,
      originalAllow: allow.toString(),
      originalDeny: deny.toString(),
      lockedAllow: '8',
      lockedDeny: (deny | send).toString(),
    });
    expect(originalSendOverride(locked)).toBe(true);
    expect(matchesLockedSnapshot(locked, {
      existed: true, allow: '8', deny: (deny | send).toString(),
    })).toBe(true);
  });

  it('restores null when Send Messages was originally inherited', () => {
    const locked = makeLockSnapshot({
      existed: false, allow: '0', deny: '0',
    });
    expect(originalSendOverride(locked)).toBeNull();
    expect(matchesLockedSnapshot(locked, {
      existed: true, allow: '0', deny: SEND_MESSAGES_BIT.toString(),
    })).toBe(true);
    expect(matchesLockedSnapshot(locked, {
      existed: false, allow: '0', deny: '0',
    })).toBe(false);
  });

  it('refuses a previously denied channel and contradictory overwrites', () => {
    expect(() => makeLockSnapshot({
      existed: true, allow: '0', deny: SEND_MESSAGES_BIT.toString(),
    })).toThrow('already denied');
    expect(() => makeLockSnapshot({
      existed: true,
      allow: SEND_MESSAGES_BIT.toString(),
      deny: SEND_MESSAGES_BIT.toString(),
    })).toThrow('Invalid');
  });

  it('refuses unlock if an admin modified any permission overwrite', () => {
    const locked = makeLockSnapshot({
      existed: true, allow: '8', deny: '0',
    });
    expect(matchesLockedSnapshot(locked, {
      existed: true, allow: '16', deny: SEND_MESSAGES_BIT.toString(),
    })).toBe(false);
    expect(matchesLockedSnapshot(locked, {
      existed: true, allow: '8', deny: '0',
    })).toBe(false);
  });

  it('bounds and cleans the audit reason', () => {
    expect(getChannelLockReason('  lockdown  ')).toBe('lockdown');
    expect(getChannelLockReason('  ')).toBeNull();
    expect(getChannelLockReason('x'.repeat(513))).toBeNull();
    expect(getChannelLockReason('safety\nreview')).toBe('safety review');
  });
});
