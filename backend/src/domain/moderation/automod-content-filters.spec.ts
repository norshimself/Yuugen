import {
  evaluateAutoMod, hasAutoModLink, validateAutoModRule, type AutoModRuleConfig,
} from './automod-policy';

describe('AutoMod content filters (#57)', () => {
  const base: AutoModRuleConfig = {
    id: 20, enabled: true, kind: 'external_link', action: 'dry_run',
    priority: 100, phrases: [], threshold: 3, windowSeconds: 10,
    exemptChannelIds: [], exemptRoleIds: [],
    allowedDomains: ['example.com'], allowedInviteCodes: ['SafeCode'],
  };
  const context = {
    channelId: '123456789012345678',
    roleIds: ['234567890123456789'],
    content: 'https://untrusted.example/path',
    messageCountInWindow: () => 0,
  };

  it('rejects external links but respects exact host and subdomain boundaries', () => {
    expect(hasAutoModLink('https://example.com/ok', 'external_link', ['example.com'])).toBe(false);
    expect(hasAutoModLink('https://help.example.com/ok', 'external_link', ['example.com'])).toBe(false);
    expect(hasAutoModLink('https://example.com.evil.test/', 'external_link', ['example.com'])).toBe(true);
    expect(hasAutoModLink('https://example.com@evil.test/', 'external_link', ['example.com'])).toBe(true);
    expect(hasAutoModLink('https://evil.test@www.example.com/', 'external_link', ['example.com'])).toBe(false);
    expect(hasAutoModLink('person@example.com', 'external_link')).toBe(false);
    expect(hasAutoModLink('example.com is a domain', 'external_link')).toBe(false);
    expect(hasAutoModLink('www.evil.test', 'external_link')).toBe(true);
  });

  it('detects direct invite links, supports codes and avoids broad text false positives', () => {
    expect(hasAutoModLink('discord.gg/UnsafeCode', 'invite_link')).toBe(true);
    expect(hasAutoModLink('https://discord.com/invite/UnsafeCode', 'invite_link')).toBe(true);
    expect(hasAutoModLink('https://discordapp.com/invite/SafeCode', 'invite_link', [], ['SafeCode'])).toBe(false);
    expect(hasAutoModLink('https://discord.com/channels/123/456', 'invite_link')).toBe(false);
    expect(hasAutoModLink('https://discord.gg.evil.test/SafeCode', 'invite_link')).toBe(false);
    expect(hasAutoModLink('https://ordinary.test/x', 'invite_link')).toBe(false);
    expect(hasAutoModLink('discord.gg/SafeCode', 'invite_link', [], ['SafeCode'])).toBe(false);
  });

  it('obeys rule priority and never overrides channel or role exemptions', () => {
    const blocked = evaluateAutoMod([base], context);
    expect(blocked).toEqual({ ruleId: 20, kind: 'external_link', action: 'dry_run' });
    expect(evaluateAutoMod([{ ...base, enabled: false }], context)).toBeNull();
    expect(evaluateAutoMod([{ ...base, exemptChannelIds: [context.channelId] }], context)).toBeNull();
    expect(evaluateAutoMod([{ ...base, exemptRoleIds: [context.roleIds[0]] }], context)).toBeNull();
    expect(evaluateAutoMod([{ ...base, allowedDomains: ['untrusted.example'] }], context)).toBeNull();
  });

  it('counts true mentions, attachment totals, and exact repeated content only', () => {
    const mentions = { ...base, kind: 'mass_mentions' as const, threshold: 3 };
    const attachments = { ...base, kind: 'attachment_rate' as const, threshold: 2 };
    const repeated = { ...base, kind: 'repeated_content' as const, threshold: 3 };
    expect(evaluateAutoMod([mentions], { ...context, mentionCount: 2 })).toBeNull();
    expect(evaluateAutoMod([mentions], { ...context, mentionCount: 3 })?.ruleId).toBe(20);
    expect(evaluateAutoMod([attachments], { ...context, attachmentCountInWindow: () => 1 })).toBeNull();
    expect(evaluateAutoMod([attachments], { ...context, attachmentCountInWindow: () => 2 })?.kind).toBe('attachment_rate');
    expect(evaluateAutoMod([repeated], { ...context, sameContentCountInWindow: () => 2 })).toBeNull();
    expect(evaluateAutoMod([repeated], { ...context, sameContentCountInWindow: () => 3 })?.kind).toBe('repeated_content');
    expect(evaluateAutoMod([repeated], context)).toBeNull();
  });

  it('validates new rule kinds, bounded allowlists, and per-kind thresholds', () => {
    expect(validateAutoModRule(base)).toBeNull();
    expect(validateAutoModRule({ ...base, kind: 'mass_mentions' })).toBeNull();
    expect(validateAutoModRule({ ...base, kind: 'attachment_rate', threshold: 1 })).toBeNull();
    expect(validateAutoModRule({ ...base, threshold: 1 })).toContain('threshold');
    expect(validateAutoModRule({ ...base, allowedDomains: ['*.example.com'] })).toContain('domains');
    expect(validateAutoModRule({ ...base, allowedDomains: ['example.com.evil.test'] })).toBeNull();
    expect(validateAutoModRule({ ...base, allowedDomains: Array(51).fill('example.com') })).toContain('domains');
    expect(validateAutoModRule({ ...base, allowedInviteCodes: ['not/a/code'] })).toContain('invite codes');
  });
});
