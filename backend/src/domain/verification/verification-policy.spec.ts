import {
  MAX_QUESTION_ATTEMPTS, MAX_PROMPT_LENGTH,
  answerModalId, buttonId, canSelfRelease, freshJoin,
  makeAnswerProof, matchesAnswer, normalizeAnswer,
  parseVerificationComponent, validDiscordId, validJoinSession,
  validVerificationPrompt, verificationChannelDenial,
} from './verification-policy';

describe('Verification policy (#64)', () => {
  const guildId = '123456789012345678';
  const joinedAt = 1800000000000;
  const join = String(joinedAt);

  it('requires real guild IDs and current join-session timestamp strings', () => {
    expect(validDiscordId(guildId)).toBe(true);
    expect(validDiscordId('@everyone')).toBe(false);
    expect(validDiscordId('123')).toBe(false);
    expect(validJoinSession(join)).toBe(true);
    expect(validJoinSession('0')).toBe(false);
    expect(validJoinSession('12345678901234567890')).toBe(false);
    expect(validJoinSession({})).toBe(false);
  });

  it('rejects gateway join replay after two minutes and future timestamps', () => {
    expect(freshJoin(joinedAt, joinedAt)).toBe(true);
    expect(freshJoin(joinedAt, joinedAt + 120000)).toBe(true);
    expect(freshJoin(joinedAt, joinedAt + 120001)).toBe(false);
    expect(freshJoin(joinedAt + 2001, joinedAt)).toBe(false);
    expect(freshJoin(Number.NaN, joinedAt)).toBe(false);
    expect(freshJoin(0, joinedAt)).toBe(false);
  });

  it('uses Discord-sized, single-line modal questions', () => {
    expect(MAX_PROMPT_LENGTH).toBe(45);
    expect(validVerificationPrompt('What is the server keyword?')).toBe(true);
    expect(validVerificationPrompt('Q'.repeat(46))).toBe(false);
    expect(validVerificationPrompt('What\nis this?')).toBe(false);
    expect(validVerificationPrompt('')).toBe(false);
  });

  it('normalizes short answers but rejects control characters and overlength', () => {
    expect(normalizeAnswer('  HÉLLO  ')).toBe('héllo');
    expect(normalizeAnswer('')).toBeNull();
    expect(normalizeAnswer('a'.repeat(81))).toBeNull();
    expect(normalizeAnswer('x\nadmin')).toBeNull();
    expect(normalizeAnswer({ answer: 'yes' })).toBeNull();
  });

  it('stores only salted fixed-length hash and verifies answers without plaintext', () => {
    const proof = makeAnswerProof('Answers   42');
    expect(proof).not.toBeNull();
    expect(proof!.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(proof!.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(proof)).not.toContain('Answers   42');
    expect(matchesAnswer(' answers   42 ', proof!.salt, proof!.digest)).toBe(true);
    expect(matchesAnswer('wrong', proof!.salt, proof!.digest)).toBe(false);
  });

  it('uses independent random salts for the same simple answer', () => {
    const a = makeAnswerProof('yes')!;
    const b = makeAnswerProof('yes')!;
    expect(a.salt).not.toBe(b.salt);
    expect(a.digest).not.toBe(b.digest);
    expect(matchesAnswer('yes', a.salt, b.digest)).toBe(false);
  });

  it('fails closed for missing, malformed or forged stored proof data', () => {
    const proof = makeAnswerProof('correct')!;
    expect(matchesAnswer('correct', 'invalid', proof.digest)).toBe(false);
    expect(matchesAnswer('correct', proof.salt, 'bad')).toBe(false);
    expect(matchesAnswer('correct', null, proof.digest)).toBe(false);
    expect(matchesAnswer(null, proof.salt, proof.digest)).toBe(false);
  });

  it('creates bounded versioned button and session-bound modal IDs', () => {
    expect(buttonId(guildId, 6)).toBe('yverify:open:' + guildId + ':6');
    expect(answerModalId(guildId, 6, join))
      .toBe('yverify:answer:' + guildId + ':6:' + join);
    expect(buttonId(guildId, 0)).toBeNull();
    expect(buttonId(guildId, 1000000000)).toBeNull();
    expect(answerModalId(guildId, 6, 'invalid')).toBeNull();
  });

  it('parses only legitimate verification controls, not copied arbitrary values', () => {
    expect(parseVerificationComponent(buttonId(guildId, 6))).toEqual({
      kind: 'open', guildId, revision: 6,
    });
    expect(parseVerificationComponent(answerModalId(guildId, 6, join))).toEqual({
      kind: 'answer', guildId, revision: 6, sessionKey: join,
    });
    expect(parseVerificationComponent('yverify:open:' + guildId + ':0')).toBeNull();
    expect(parseVerificationComponent('yverify:answer:' + guildId + ':6:old')).toBeNull();
    expect(parseVerificationComponent('yverify:open:1:6')).toBeNull();
    expect(parseVerificationComponent('other:open:' + guildId + ':6')).toBeNull();
  });

  it('requires a live quarantine role and exact current join session to release', () => {
    expect(canSelfRelease('quarantined', true, join, join)).toBe(true);
    expect(canSelfRelease('quarantined', false, join, join)).toBe(false);
    expect(canSelfRelease('join_pending', true, join, join)).toBe(false);
    expect(canSelfRelease('release_uncertain', true, join, join)).toBe(false);
    expect(canSelfRelease('quarantined', true,
      String(joinedAt + 5000), join)).toBe(false);
  });

  it('fails closed on privilege, missing channel visibility or unsafe overwrites', () => {
    const safe = {
      roleSafe: true, botCanManageRoles: true, botAboveRole: true,
      botCanSeeAndPost: true, quarantineCanViewVerification: true,
      unsafeOverwrites: false, otherVisibleChannels: false,
    };
    expect(verificationChannelDenial(safe)).toBeNull();
    expect(verificationChannelDenial({ ...safe, roleSafe: false }))
      .toContain('ordinary');
    expect(verificationChannelDenial({ ...safe, botCanSeeAndPost: false }))
      .toContain('visible');
    expect(verificationChannelDenial({ ...safe, otherVisibleChannels: true }))
      .toContain('beyond');
    expect(verificationChannelDenial({ ...safe, unsafeOverwrites: true }))
      .toContain('beyond');
    expect(MAX_QUESTION_ATTEMPTS).toBe(5);
  });
});
