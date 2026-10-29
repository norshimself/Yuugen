import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type VerificationMode = 'button' | 'question';
export type VerificationStatus = 'draft' | 'publishing' | 'active' | 'disabled';
export type VerificationSessionStatus =
  | 'join_pending' | 'quarantined' | 'join_failed' | 'join_uncertain'
  | 'release_pending' | 'release_uncertain' | 'released';

export const VERIFY_PREFIX = 'yverify';
export const MAX_QUESTION_ATTEMPTS = 5;
export const JOIN_EVENT_MAX_AGE_MS = 120_000;
export const VERIFY_LEASE_MINUTES = 2;
export const MAX_PROMPT_LENGTH = 140;
const SNOWFLAKE = /^\d{17,20}$/;
const SESSION = /^\d{12,16}$/;
const OPEN_ID = /^yverify:open:(\d{17,20}):([1-9]\d{0,8})$/;
const MODAL_ID = /^yverify:answer:(\d{17,20}):([1-9]\d{0,8}):(\d{12,16})$/;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function validDiscordId(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE.test(value);
}
export function validJoinSession(value: unknown): value is string {
  return typeof value === 'string' && SESSION.test(value) &&
    Number.isSafeInteger(Number(value)) && Number(value) > 0;
}
export function freshJoin(joinMs: number, nowMs: number): boolean {
  return Number.isSafeInteger(joinMs) && Number.isSafeInteger(nowMs) &&
    joinMs > 0 && joinMs <= nowMs + 2000 &&
    joinMs >= nowMs - JOIN_EVENT_MAX_AGE_MS;
}
export function validVerificationPrompt(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0 &&
    input.length <= MAX_PROMPT_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(input);
}
export function normalizeAnswer(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(input)) return null;
  const normalized = input.normalize('NFKC').trim().toLowerCase();
  return normalized.length >= 1 && normalized.length <= 80 ? normalized : null;
}
/** Not a CAPTCHA. A salted hash only prevents storing plain answer text. */
export function makeAnswerProof(answer: string): { salt: string; digest: string } | null {
  const cleaned = normalizeAnswer(answer);
  if (!cleaned) return null;
  const salt = randomBytes(16).toString('hex');
  return { salt, digest: createHash('sha256').update(salt + ':' + cleaned).digest('hex') };
}
export function matchesAnswer(
  answer: unknown, salt: unknown, digest: unknown,
): boolean {
  const cleaned = normalizeAnswer(answer);
  if (!cleaned || typeof salt !== 'string' || !HEX32.test(salt) ||
      typeof digest !== 'string' || !HEX64.test(digest)) return false;
  const actual = createHash('sha256').update(salt + ':' + cleaned).digest();
  return timingSafeEqual(actual, Buffer.from(digest, 'hex'));
}

export function buttonId(guildId: string, revision: number): string | null {
  return validDiscordId(guildId) && Number.isSafeInteger(revision) &&
    revision >= 1 && revision <= 999999999
    ? 'yverify:open:' + guildId + ':' + revision : null;
}
export function answerModalId(
  guildId: string, revision: number, sessionKey: string,
): string | null {
  const prefix = buttonId(guildId, revision);
  return prefix && validJoinSession(sessionKey)
    ? 'yverify:answer:' + guildId + ':' + revision + ':' + sessionKey : null;
}
export function parseVerificationComponent(value: unknown):
  | { kind: 'open'; guildId: string; revision: number }
  | { kind: 'answer'; guildId: string; revision: number; sessionKey: string }
  | null {
  if (typeof value !== 'string') return null;
  const open = OPEN_ID.exec(value);
  if (open) return { kind: 'open', guildId: open[1], revision: Number(open[2]) };
  const modal = MODAL_ID.exec(value);
  if (modal && validJoinSession(modal[3])) {
    return { kind: 'answer', guildId: modal[1],
      revision: Number(modal[2]), sessionKey: modal[3] };
  }
  return null;
}
export function verificationChannelDenial(input: {
  roleSafe: boolean; botCanManageRoles: boolean; botAboveRole: boolean;
  botCanSeeAndPost: boolean; quarantineCanViewVerification: boolean;
  unsafeOverwrites: boolean; otherVisibleChannels: boolean;
}): string | null {
  if (!input.roleSafe || !input.botCanManageRoles || !input.botAboveRole) {
    return 'Quarantine role must be ordinary, unprivileged and below the bot.';
  }
  if (!input.botCanSeeAndPost || !input.quarantineCanViewVerification) {
    return 'The verification channel must be visible to the quarantine role and writable by Yuugen.';
  }
  if (input.unsafeOverwrites || input.otherVisibleChannels) {
    return 'Quarantine role must not grant access beyond the verification channel.';
  }
  return null;
}
/** A removed quarantine role is the ONLY self-service permission mutation. */
export function canSelfRelease(
  sessionStatus: VerificationSessionStatus,
  hasQuarantineRole: boolean,
  currentJoin: string, sessionJoin: string,
): boolean {
  return sessionStatus === 'quarantined' && hasQuarantineRole &&
    validJoinSession(currentJoin) && currentJoin === sessionJoin;
}
