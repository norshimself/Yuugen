export type AutoModKind = 'blocked_phrases' | 'message_rate';
export type AutoModAction = 'dry_run' | 'delete';

export interface AutoModRuleConfig {
  id: number;
  enabled: boolean;
  kind: AutoModKind;
  action: AutoModAction;
  priority: number;
  phrases: string[];
  threshold: number;
  windowSeconds: number;
  exemptChannelIds: string[];
  exemptRoleIds: string[];
}

export interface AutoModContext {
  channelId: string;
  roleIds: readonly string[];
  content: string;
  messageCountInWindow: (seconds: number) => number;
}

export interface AutoModDecision {
  ruleId: number;
  kind: AutoModKind;
  action: AutoModAction;
}

const snowflake = /^\d{17,20}$/;
function tokens(value: string): string[] {
  return value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

export function containsAutoModPhrase(content: string, phrases: readonly string[]): boolean {
  const words = tokens(content).slice(0, 2000);
  for (const phrase of phrases.slice(0, 100)) {
    const sought = tokens(phrase).slice(0, 20);
    if (!sought.length || sought.length > words.length) continue;
    for (let start = 0; start <= words.length - sought.length; start++) {
      if (sought.every((word, i) => words[start + i] === word)) return true;
    }
  }
  return false;
}

/** Rules sorted deterministically; exemptions take priority over matching. */
export function evaluateAutoMod(
  rules: readonly AutoModRuleConfig[],
  context: AutoModContext,
): AutoModDecision | null {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.id - b.id);
  for (const rule of sorted.slice(0, 50)) {
    if (!rule.enabled) continue;
    if (rule.exemptChannelIds.includes(context.channelId)) continue;
    if (rule.exemptRoleIds.some(id => context.roleIds.includes(id))) continue;
    if (rule.kind === 'blocked_phrases' &&
        containsAutoModPhrase(context.content, rule.phrases)) {
      return { ruleId: rule.id, kind: rule.kind, action: rule.action };
    }
    if (rule.kind === 'message_rate' &&
        context.messageCountInWindow(rule.windowSeconds) >= rule.threshold) {
      return { ruleId: rule.id, kind: rule.kind, action: rule.action };
    }
  }
  return null;
}

export function validateAutoModRule(input: Omit<AutoModRuleConfig, 'id'>): string | null {
  if (!input || !['blocked_phrases', 'message_rate'].includes(input.kind)) return 'Invalid rule kind';
  if (!['dry_run', 'delete'].includes(input.action)) return 'Invalid action';
  if (typeof input.enabled !== 'boolean') return 'Invalid enabled state';
  if (!Number.isSafeInteger(input.priority) || input.priority < 0 || input.priority > 10000) return 'Invalid priority';
  if (!Array.isArray(input.phrases) || input.phrases.length > 100 ||
      input.phrases.some(p => typeof p !== 'string' || !tokens(p).length ||
        p.length > 100 || tokens(p).length > 20)) return 'Invalid phrases';
  if (input.kind === 'blocked_phrases' && !input.phrases.length) return 'Phrases required';
  if (!Number.isSafeInteger(input.threshold) || input.threshold < 2 || input.threshold > 20) return 'Invalid message threshold';
  if (!Number.isSafeInteger(input.windowSeconds) || input.windowSeconds < 2 || input.windowSeconds > 60) return 'Invalid window';
  if (!Array.isArray(input.exemptChannelIds) || input.exemptChannelIds.length > 50 ||
      input.exemptChannelIds.some(s => !snowflake.test(s))) return 'Invalid exempt channels';
  if (!Array.isArray(input.exemptRoleIds) || input.exemptRoleIds.length > 50 ||
      input.exemptRoleIds.some(s => !snowflake.test(s))) return 'Invalid exempt roles';
  return null;
}
