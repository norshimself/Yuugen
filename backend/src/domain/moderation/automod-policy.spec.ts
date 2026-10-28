import {
  containsAutoModPhrase,
  evaluateAutoMod,
  validateAutoModRule,
  type AutoModRuleConfig,
} from './automod-policy';

describe('AutoMod deterministic rule engine', () => {
  const base: AutoModRuleConfig = {
    id: 1, enabled: true, kind: 'blocked_phrases',
    action: 'dry_run', priority: 100, phrases: ['bad word'],
    threshold: 6, windowSeconds: 8, exemptChannelIds: [],
    exemptRoleIds: [],
  };
  const context = {
    channelId: '123456789012345678',
    roleIds: ['234567890123456789'],
    content: 'please stop this bad word',
    messageCountInWindow: jest.fn().mockReturnValue(0),
  };

  it('normalizes Unicode and matches whole words, not substrings', () => {
    expect(containsAutoModPhrase('This BAD WORD.', ['bad word'])).toBe(true);
    expect(containsAutoModPhrase('ｂａｄ ｗｏｒｄ', ['bad word'])).toBe(true);
    expect(containsAutoModPhrase('classification', ['ass'])).toBe(false);
    expect(containsAutoModPhrase('clean', ['bad word'])).toBe(false);
  });

  it('applies enabled rules only and defaults to dry-run', () => {
    expect(evaluateAutoMod([base], context)).toEqual({
      ruleId: 1, kind: 'blocked_phrases', action: 'dry_run',
    });
    expect(evaluateAutoMod([{ ...base, enabled: false }], context)).toBeNull();
  });

  it('exempts channels and role IDs before any action', () => {
    expect(evaluateAutoMod([{
      ...base, exemptChannelIds: [context.channelId],
    }], context)).toBeNull();
    expect(evaluateAutoMod([{
      ...base, exemptRoleIds: [context.roleIds[0]],
    }], context)).toBeNull();
  });

  it('enforces explicit priority and ID tie-breaking', () => {
    const a = { ...base, id: 10, priority: 10, action: 'delete' as const };
    const b = { ...base, id: 4, priority: 10, action: 'dry_run' as const };
    expect(evaluateAutoMod([a, b], context)?.ruleId).toBe(4);
    expect(evaluateAutoMod([{ ...a, priority: 1 }, b], context)?.ruleId).toBe(10);
  });

  it('detects message rate using a bounded rule threshold', () => {
    const rate: AutoModRuleConfig = {
      ...base, id: 9, kind: 'message_rate', action: 'delete',
    };
    expect(evaluateAutoMod([rate], {
      ...context, content: '', messageCountInWindow: () => 5,
    })).toBeNull();
    expect(evaluateAutoMod([rate], {
      ...context, content: '', messageCountInWindow: () => 6,
    })).toEqual({ ruleId: 9, kind: 'message_rate', action: 'delete' });
  });

  it('rejects invalid kinds, actions, thresholds and priorities', () => {
    expect(validateAutoModRule(base)).toBeNull();
    expect(validateAutoModRule({ ...base, action: 'timeout' as any })).toContain('action');
    expect(validateAutoModRule({ ...base, kind: 'regex' as any })).toContain('kind');
    expect(validateAutoModRule({ ...base, priority: -1 })).toContain('priority');
    expect(validateAutoModRule({ ...base, threshold: 1 })).toContain('threshold');
    expect(validateAutoModRule({ ...base, windowSeconds: 61 })).toContain('window');
  });

  it('bounds phrase lengths, count and role/channel allowlists', () => {
    expect(validateAutoModRule({ ...base, phrases: [] })).toContain('required');
    expect(validateAutoModRule({ ...base, phrases: ['x'.repeat(101)] })).toContain('phrases');
    expect(validateAutoModRule({ ...base, phrases: Array(101).fill('spam') })).toContain('phrases');
    expect(validateAutoModRule({ ...base, exemptRoleIds: ['bogus'] })).toContain('roles');
    expect(validateAutoModRule({ ...base, exemptChannelIds: ['bogus'] })).toContain('channels');
  });

  it('never interpolates or executes user-provided regex', () => {
    expect(containsAutoModPhrase('hello', ['^(a+)+$'])).toBe(false);
    expect(containsAutoModPhrase('aaaaaa', ['^(a+)+$'])).toBe(false);
  });
});
