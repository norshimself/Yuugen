/** Pure helpers for opt-in, no-privilege onboarding. */
export type OnboardingReceiptKind = 'welcome' | 'goodbye' | 'welcome_dm';
export type OnboardingOutcome =
  | 'sent' | 'missing_permissions' | 'dm_unavailable' | 'config_changed';

export const DEFAULT_GOODBYE_MESSAGE = 'Goodbye {user} from {guild}.';
export const DEFAULT_WELCOME_DM_MESSAGE = 'Welcome to {guild}, {user}!';
export const MAX_ONBOARDING_AGE_MS = 2 * 60_000;
export const RULES_ACK_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

const snowflake = /^\d{17,20}$/;
const session = /^\d{12,16}$/;
const ackId = /^yuugen:rules:(\d{17,20}):(\d{12,16})$/;
const receiptTypes: readonly OnboardingReceiptKind[] = [
  'welcome', 'goodbye', 'welcome_dm',
];

export function validSnowflake(value: unknown): value is string {
  return typeof value === 'string' && snowflake.test(value);
}

export function validSessionKey(value: unknown): value is string {
  return typeof value === 'string' && session.test(value) &&
    Number.isSafeInteger(Number(value));
}

export function isRecentOnboardingJoin(joinedAtMs: number, nowMs: number): boolean {
  return Number.isSafeInteger(joinedAtMs) && Number.isSafeInteger(nowMs) &&
    joinedAtMs > 0 && joinedAtMs <= nowMs + 2000 &&
    joinedAtMs >= nowMs - MAX_ONBOARDING_AGE_MS;
}

/**
 * Do not allow guild-controlled template strings or names to create new
 * lines or active mentions via substitution. Discord's outbound
 * allowedMentions is separately restricted on every send.
 */
export function formatOnboardingMessage(
  template: string,
  userToken: string,
  guildName: string,
  maxLength = 1800,
): string {
  const safeName = guildName.replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 100);
  const safeUser = userToken.replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 100);
  return template.replace(/\{(user|guild)\}/gi, (_, token: string) =>
    token.toLowerCase() === 'user' ? safeUser : safeName)
    .slice(0, maxLength);
}

export function validateOnboardingTemplate(
  value: unknown,
  maxLength = 1500,
): boolean {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.length <= maxLength && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

export function rulesButtonId(guildId: string, sessionKey: string): string | null {
  if (!validSnowflake(guildId) || !validSessionKey(sessionKey)) return null;
  return 'yuugen:rules:' + guildId + ':' + sessionKey;
}

export function parseRulesButtonId(value: unknown): {
  guildId: string; sessionKey: string;
} | null {
  if (typeof value !== 'string') return null;
  const match = ackId.exec(value);
  if (!match || !validSessionKey(match[2])) return null;
  return { guildId: match[1], sessionKey: match[2] };
}

export function canAcknowledgeRules(
  sessionKey: string, joinedAtMs: number, nowMs: number,
): boolean {
  if (!validSessionKey(sessionKey) || !Number.isSafeInteger(joinedAtMs) ||
      !Number.isSafeInteger(nowMs) || Number(sessionKey) !== joinedAtMs) return false;
  return joinedAtMs <= nowMs + 2000 &&
    nowMs - joinedAtMs <= RULES_ACK_MAX_AGE_MS;
}

export function validOnboardingReceipt(
  guildId: string, userId: string, kind: OnboardingReceiptKind,
  sessionKey: string,
): boolean {
  return validSnowflake(guildId) && validSnowflake(userId) &&
    receiptTypes.includes(kind) && validSessionKey(sessionKey);
}

export function isDMDisabledError(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && error.code === 50007;
}
