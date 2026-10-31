export type AutoModKind =
  | 'blocked_phrases'
  | 'message_rate'
  | 'invite_link'
  | 'external_link'
  | 'mass_mentions'
  | 'attachment_rate'
  | 'repeated_content';
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
  /** Exact host or its subdomains, never a substring or arbitrary wildcard. */
  allowedDomains?: string[];
  /** Exact (case-sensitive) Discord invite codes. */
  allowedInviteCodes?: string[];
}

export interface AutoModContext {
  channelId: string;
  roleIds: readonly string[];
  content: string;
  messageCountInWindow: (seconds: number) => number;
  mentionCount?: number;
  attachmentCountInWindow?: (seconds: number) => number;
  sameContentCountInWindow?: (seconds: number) => number;
}

export interface AutoModDecision {
  ruleId: number;
  kind: AutoModKind;
  action: AutoModAction;
}

const snowflake = /^\d{17,20}$/;
const domain = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const inviteCode = /^[A-Za-z0-9_-]{2,32}$/;
// Only actual URL-shaped text is considered; arbitrary words like "example.com"
// and e-mail domains are not link violations. Discord invite URLs may omit
// https:// because Discord auto-links those hosts.
const linkPattern = /(^|[^\p{L}\p{N}_@.-])((?:https?:\/\/|www\.|discord\.gg\/|discord(?:app)?\.com\/invite\/)[^\s<>"'\u0060]+)/giu;

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

function isAllowedHost(host: string, allowedDomains: readonly string[]): boolean {
  return allowedDomains.some(raw => {
    const allow = raw.toLowerCase();
    return host === allow || host.endsWith('.' + allow);
  });
}

/**
 * Return true if there is a non-allowlisted Discord invite or URL.
 * Parsed URL.hostnames avoid spoofing via userinfo, suffixes, ports, or
 * Unicode/punycode host spelling. Invalid URLs are not silently "fixed".
 * There is no network lookup or arbitrary admin-supplied regex.
 */
export function hasAutoModLink(
  content: string,
  kind: 'invite_link' | 'external_link',
  allowedDomains: readonly string[] = [],
  allowedInviteCodes: readonly string[] = [],
): boolean {
  if (typeof content !== 'string') return false;
  const text = content.slice(0, 4000).normalize('NFKC');
  let checked = 0;
  for (const match of text.matchAll(linkPattern)) {
    if (++checked > 25) break;
    const candidate = match[2].replace(/[.,!?;:)\]}]+$/u, '');
    const target = /^https?:\/\//i.test(candidate) ? candidate : 'https://' + candidate;
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const inviteHost = host.replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    const isInvite = inviteHost === 'discord.gg'
      ? parts.length === 1 && inviteCode.test(parts[0])
      : (inviteHost === 'discord.com' || inviteHost === 'discordapp.com') &&
        parts.length === 2 && parts[0].toLowerCase() === 'invite' &&
        inviteCode.test(parts[1]);
    if (isAllowedHost(host, allowedDomains)) continue;
    if (isInvite && allowedInviteCodes.includes(parts[parts.length - 1])) continue;
    if (kind === 'external_link' || (kind === 'invite_link' && isInvite)) return true;
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
    let matched = false;
    switch (rule.kind) {
      case 'blocked_phrases':
        matched = containsAutoModPhrase(context.content, rule.phrases);
        break;
      case 'message_rate':
        matched = context.messageCountInWindow(rule.windowSeconds) >= rule.threshold;
        break;
      case 'invite_link':
      case 'external_link':
        matched = hasAutoModLink(
          context.content, rule.kind, rule.allowedDomains, rule.allowedInviteCodes,
        );
        break;
      case 'mass_mentions':
        matched = (context.mentionCount ?? 0) >= rule.threshold;
        break;
      case 'attachment_rate':
        matched = (context.attachmentCountInWindow?.(rule.windowSeconds) ?? 0) >= rule.threshold;
        break;
      case 'repeated_content':
        matched = (context.sameContentCountInWindow?.(rule.windowSeconds) ?? 0) >= rule.threshold;
        break;
    }
    if (matched) return { ruleId: rule.id, kind: rule.kind, action: rule.action };
  }
  return null;
}

export function validateAutoModRule(input: Omit<AutoModRuleConfig, 'id'>): string | null {
  if (!input || ![
    'blocked_phrases', 'message_rate', 'invite_link', 'external_link',
    'mass_mentions', 'attachment_rate', 'repeated_content',
  ].includes(input.kind)) return 'Invalid rule kind';
  if (!['dry_run', 'delete'].includes(input.action)) return 'Invalid action';
  if (typeof input.enabled !== 'boolean') return 'Invalid enabled state';
  if (!Number.isSafeInteger(input.priority) || input.priority < 0 || input.priority > 10000) return 'Invalid priority';
  if (!Array.isArray(input.phrases) || input.phrases.length > 100 ||
      input.phrases.some(p => typeof p !== 'string' || !tokens(p).length ||
        p.length > 100 || tokens(p).length > 20)) return 'Invalid phrases';
  if (input.kind === 'blocked_phrases' && !input.phrases.length) return 'Phrases required';
  const minThreshold = input.kind === 'attachment_rate' ? 1 : 2;
  if (!Number.isSafeInteger(input.threshold) ||
      input.threshold < minThreshold || input.threshold > 20) return 'Invalid message threshold';
  if (!Number.isSafeInteger(input.windowSeconds) ||
      input.windowSeconds < 2 || input.windowSeconds > 60) return 'Invalid window';
  if (!Array.isArray(input.exemptChannelIds) || input.exemptChannelIds.length > 50 ||
      input.exemptChannelIds.some(s => typeof s !== 'string' || !snowflake.test(s))) return 'Invalid exempt channels';
  if (!Array.isArray(input.exemptRoleIds) || input.exemptRoleIds.length > 50 ||
      input.exemptRoleIds.some(s => typeof s !== 'string' || !snowflake.test(s))) return 'Invalid exempt roles';
  if (input.allowedDomains !== undefined &&
      (!Array.isArray(input.allowedDomains) || input.allowedDomains.length > 50 ||
        input.allowedDomains.some(s => typeof s !== 'string' || !domain.test(s)))) {
    return 'Invalid allowed domains';
  }
  if (input.allowedInviteCodes !== undefined &&
      (!Array.isArray(input.allowedInviteCodes) || input.allowedInviteCodes.length > 50 ||
        input.allowedInviteCodes.some(s => typeof s !== 'string' || !inviteCode.test(s)))) {
    return 'Invalid allowed invite codes';
  }
  return null;
}
