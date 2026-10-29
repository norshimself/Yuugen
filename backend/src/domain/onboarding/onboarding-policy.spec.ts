import {
  canAcknowledgeRules, DEFAULT_GOODBYE_MESSAGE,
  formatOnboardingMessage, isDMDisabledError, isRecentOnboardingJoin,
  parseRulesButtonId, rulesButtonId, validOnboardingReceipt,
  validSessionKey, validateOnboardingTemplate,
} from './onboarding-policy';

describe('Opt-in onboarding policy (#62)', () => {
  const guildId = '123456789012345678';
  const memberId = '234567890123456789';
  const now = 1800000000000;
  const session = String(now);

  it('formats all placeholder occurrences without replacement interpolation', () => {
    expect(formatOnboardingMessage(
      '{user} -> {guild}; {USER} @everyone', '<@' + memberId + '>',
      'Moon $& Garden',
    )).toBe('<@' + memberId + '> -> Moon $& Garden; <@' +
      memberId + '> @everyone');
    expect(formatOnboardingMessage('{guild}', '', 'a\nb\r@here'))
      .toBe('a b @here');
    expect(formatOnboardingMessage('x'.repeat(3000), '', '', 1800))
      .toHaveLength(1800);
    expect(DEFAULT_GOODBYE_MESSAGE).toContain('{user}');
  });

  it('rejects invalid templates but accepts non-English and normal newlines', () => {
    expect(validateOnboardingTemplate('Bonjour {user}!\nWelcome.')).toBe(true);
    expect(validateOnboardingTemplate('')).toBe(false);
    expect(validateOnboardingTemplate('   ')).toBe(false);
    expect(validateOnboardingTemplate('a'.repeat(1501))).toBe(false);
    expect(validateOnboardingTemplate('hello\u0000hidden')).toBe(false);
    expect(validateOnboardingTemplate('hello'.repeat(20))).toBe(true);
  });

  it('requires a recent real Discord join timestamp', () => {
    expect(isRecentOnboardingJoin(now, now)).toBe(true);
    expect(isRecentOnboardingJoin(now - 120000, now)).toBe(true);
    expect(isRecentOnboardingJoin(now - 120001, now)).toBe(false);
    expect(isRecentOnboardingJoin(now + 2001, now)).toBe(false);
    expect(isRecentOnboardingJoin(Number.NaN, now)).toBe(false);
    expect(isRecentOnboardingJoin(0, now)).toBe(false);
  });

  it('creates and parses safe guild/session-bound DM button IDs', () => {
    const id = rulesButtonId(guildId, session);
    expect(id).toBe('yuugen:rules:' + guildId + ':' + session);
    expect(parseRulesButtonId(id)).toEqual({ guildId, sessionKey: session });
    expect(parseRulesButtonId('yuugen:rules:' + guildId + ':evil')).toBeNull();
    expect(parseRulesButtonId('yuugen:rules:' + guildId + ':0')).toBeNull();
    expect(rulesButtonId('not-guild', session)).toBeNull();
    expect(validSessionKey(session)).toBe(true);
  });

  it('requires same session and limits rules acknowledgement to seven days', () => {
    expect(canAcknowledgeRules(session, now, now + 3600000)).toBe(true);
    expect(canAcknowledgeRules(session, now, now + 7 * 24 * 3600000))
      .toBe(true);
    expect(canAcknowledgeRules(session, now, now + 7 * 24 * 3600000 + 1))
      .toBe(false);
    expect(canAcknowledgeRules(session, now - 1000, now + 3600000)).toBe(false);
    expect(canAcknowledgeRules(session, now, now - 2001)).toBe(false);
  });

  it('validates durable guild/user/receipt keys for all event types', () => {
    expect(validOnboardingReceipt(guildId, memberId, 'welcome', session)).toBe(true);
    expect(validOnboardingReceipt(guildId, memberId, 'goodbye', session)).toBe(true);
    expect(validOnboardingReceipt(guildId, memberId, 'welcome_dm', session)).toBe(true);
    expect(validOnboardingReceipt(guildId, 'bad', 'welcome', session)).toBe(false);
    expect(validOnboardingReceipt(guildId, memberId, 'ban' as any, session))
      .toBe(false);
  });

  it('identifies only confirmed Discord DM-closed response code 50007', () => {
    expect(isDMDisabledError({ code: 50007 })).toBe(true);
    expect(isDMDisabledError({ code: 50013 })).toBe(false);
    expect(isDMDisabledError(new Error('Cannot send DMs'))).toBe(false);
    expect(isDMDisabledError(null)).toBe(false);
  });
});
