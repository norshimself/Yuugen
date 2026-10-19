import {
  containsBlockedPhrase,
  inspectMessage,
  MessageActivity,
  ModerationRules,
} from './moderation';

const defaults: ModerationRules = {
  antiSpamEnabled: false,
  profanityFilterEnabled: false,
  blacklistedWords: [],
};

describe('guild moderation rule evaluation', () => {
  it('matches words/phrases case-insensitively without substring false positives', () => {
    expect(containsBlockedPhrase('Do not say BAD word!', ['bad word'])).toBe(true);
    expect(containsBlockedPhrase('Some CLASS details', ['ass'])).toBe(false);
    expect(containsBlockedPhrase('TÉST phrase', ['tést phrase'])).toBe(true);
    expect(containsBlockedPhrase('hello there', ['spam'])).toBe(false);
  });

  it('only applies blacklist rules when the switch is enabled', () => {
    const off = inspectMessage('bad word', {
      ...defaults, blacklistedWords: ['bad word'],
    }, 1000);
    const on = inspectMessage('bad word', {
      ...defaults, profanityFilterEnabled: true, blacklistedWords: ['bad word'],
    }, 1000);
    expect(off.reason).toBeNull();
    expect(on.reason).toBe('blacklist');
  });

  it('blocks the third repeated message within 12 seconds', () => {
    const rules = { ...defaults, antiSpamEnabled: true };
    let state: MessageActivity | undefined;
    for (let i = 0; i < 3; i++) {
      const result = inspectMessage('copy paste', rules, 1000 + 500 * i, state);
      expect(result.reason).toBe(i === 2 ? 'spam' : null);
      state = result.activity;
    }
  });

  it('blocks the sixth distinct message within eight seconds', () => {
    const rules = { ...defaults, antiSpamEnabled: true };
    let state: MessageActivity | undefined;
    for (let i = 0; i < 6; i++) {
      const result = inspectMessage(`message ${i}`, rules, 2000 + i * 300, state);
      expect(result.reason).toBe(i === 5 ? 'spam' : null);
      state = result.activity;
    }
  });

  it('does not moderate ordinary messages when features are switched off', () => {
    const result = inspectMessage('normal', defaults, 100);
    expect(result.reason).toBeNull();
  });
});
