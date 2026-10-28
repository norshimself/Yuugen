import {
  cleanVoiceReason,
  definitiveVoiceRejection,
  getVoiceActionDenial,
  type VoiceActionInput,
} from './voice-policy';

describe('voice moderation policy', () => {
  const input: VoiceActionInput = {
    action: 'mute',
    actorId: '123456789012345678',
    targetId: '234567890123456789',
    guildOwnerId: '345678901234567890',
    targetExists: true,
    targetIsBot: false,
    targetIsAdministrator: false,
    actorAboveTarget: true,
    botAboveTarget: true,
    sourceChannelId: '456789012345678901',
    connectedChannelId: '456789012345678901',
    sourceIsVoice: true,
    destinationChannelId: null,
    destinationIsVoice: false,
    actorCanModerateSource: true,
    botCanModerateSource: true,
    actorCanModerateDestination: false,
    botCanModerateDestination: false,
    actorCanConnectDestination: false,
    botCanConnectDestination: false,
    serverMute: false,
    serverDeaf: false,
  };

  it('permits muting a joined, unmuted member with both permissions', () => {
    expect(getVoiceActionDenial(input)).toBeNull();
  });

  it('rejects self, owner, bots and administrator targets', () => {
    expect(getVoiceActionDenial({ ...input, targetId: input.actorId }))
      .toContain('yourself');
    expect(getVoiceActionDenial({ ...input, targetId: input.guildOwnerId }))
      .toContain('owner');
    expect(getVoiceActionDenial({ ...input, targetIsBot: true }))
      .toContain('bots');
    expect(getVoiceActionDenial({ ...input, targetIsAdministrator: true }))
      .toContain('Administrators');
    expect(getVoiceActionDenial({ ...input, targetExists: false }))
      .toContain('no longer');
  });

  it('enforces moderator and bot role hierarchy separately', () => {
    expect(getVoiceActionDenial({ ...input, actorAboveTarget: false }))
      .toContain('highest role');
    expect(getVoiceActionDenial({ ...input, botAboveTarget: false }))
      .toContain('Yuugen must');
    expect(getVoiceActionDenial({
      ...input,
      actorId: input.guildOwnerId,
      actorAboveTarget: false,
    })).toBeNull();
    expect(getVoiceActionDenial({
      ...input,
      actorId: input.guildOwnerId,
      actorAboveTarget: false,
      botAboveTarget: false,
    })).toContain('Yuugen must');
  });

  it('requires active membership in the expected voice source', () => {
    for (const changes of [
      { connectedChannelId: null },
      { connectedChannelId: '567890123456789012' },
      { sourceChannelId: null },
      { sourceIsVoice: false },
    ]) {
      expect(getVoiceActionDenial({ ...input, ...changes }))
        .toContain('expected voice channel');
    }
  });

  it('checks the exact source channel permission for actor and bot', () => {
    expect(getVoiceActionDenial({
      ...input, actorCanModerateSource: false,
    })).toContain('You lack');
    expect(getVoiceActionDenial({
      ...input, botCanModerateSource: false,
    })).toContain('Yuugen lacks');
  });

  it('uses server-only mute state, including unknown and repeat actions', () => {
    expect(getVoiceActionDenial({ ...input, serverMute: true }))
      .toContain('already');
    expect(getVoiceActionDenial({ ...input, serverMute: null }))
      .toContain('Cannot verify');
    expect(getVoiceActionDenial({
      ...input, action: 'unmute', serverMute: false,
    })).toContain('not server-muted');
    expect(getVoiceActionDenial({
      ...input, action: 'unmute', serverMute: true,
    })).toBeNull();
  });

  it('uses server-only deaf state, not self-deafen status', () => {
    expect(getVoiceActionDenial({
      ...input, action: 'deafen',
    })).toBeNull();
    expect(getVoiceActionDenial({
      ...input, action: 'deafen', serverDeaf: true,
    })).toContain('already');
    expect(getVoiceActionDenial({
      ...input, action: 'undeafen', serverDeaf: false,
    })).toContain('not server-deafened');
    expect(getVoiceActionDenial({
      ...input, action: 'undeafen', serverDeaf: true,
    })).toBeNull();
  });

  it('requires explicit, distinct source and destination for moves', () => {
    const move = { ...input, action: 'move' as const };
    expect(getVoiceActionDenial(move)).toContain('destination');
    expect(getVoiceActionDenial({
      ...move,
      destinationChannelId: move.sourceChannelId,
      destinationIsVoice: true,
    })).toContain('different');
    expect(getVoiceActionDenial({
      ...move, destinationChannelId: '567890123456789012',
      destinationIsVoice: true,
    })).toContain('You need');
  });

  it('requires Move Members and Connect for actor and bot at destination', () => {
    const move: VoiceActionInput = {
      ...input,
      action: 'move',
      destinationChannelId: '567890123456789012',
      destinationIsVoice: true,
      actorCanModerateDestination: true,
      botCanModerateDestination: true,
      actorCanConnectDestination: true,
      botCanConnectDestination: true,
    };
    expect(getVoiceActionDenial(move)).toBeNull();
    for (const attr of [
      'actorCanModerateDestination', 'actorCanConnectDestination',
      'botCanModerateDestination', 'botCanConnectDestination',
    ] as const) {
      expect(getVoiceActionDenial({ ...move, [attr]: false }))
        .toContain(attr.startsWith('actor') ? 'You need' : 'Yuugen needs');
    }
  });

  it('permits disconnection without a destination but requires source permission', () => {
    expect(getVoiceActionDenial({ ...input, action: 'disconnect' })).toBeNull();
    expect(getVoiceActionDenial({
      ...input, action: 'disconnect', botCanModerateSource: false,
    })).toContain('Yuugen lacks');
  });

  it('normalizes reason and classifies only certain Discord failures as definitive', () => {
    expect(cleanVoiceReason('  policy\\nreview ')).toBe('policy\\nreview');
    expect(cleanVoiceReason('ok\nthen')).toBe('ok then');
    expect(cleanVoiceReason('   ')).toBeNull();
    expect(cleanVoiceReason('x'.repeat(513))).toBeNull();
    expect(definitiveVoiceRejection({ status: 403 })).toBe(true);
    expect(definitiveVoiceRejection({ code: 50013 })).toBe(true);
    expect(definitiveVoiceRejection({ code: 10007 })).toBe(true);
    expect(definitiveVoiceRejection({ status: 404, code: 10026 })).toBe(false);
    expect(definitiveVoiceRejection(new Error('ECONNRESET'))).toBe(false);
  });
});
