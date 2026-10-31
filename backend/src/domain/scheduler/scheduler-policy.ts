/** Pure scheduler rules. UTC timestamps and database time are used for dispatch. */
export const SCHEDULED_KINDS = [
  'temporary_unban', 'reminder_send', 'giveaway_close', 'event_notice',
] as const;
export type ScheduledKind = typeof SCHEDULED_KINDS[number];

export type ScheduledPayload =
  | { targetUserId: string; moderationCaseId: number }
  | { reminderId: number }
  | { giveawayId: number }
  | { eventId: number };

export interface NewScheduledJob {
  guildId: string;
  kind: ScheduledKind;
  idempotencyKey: string;
  payload: ScheduledPayload;
  runAt: string;
  maxAttempts?: number;
}

export type JobStatus =
  | 'pending' | 'running' | 'completed' | 'canceled' | 'dead' | 'needs_review';

export interface ClaimedJob {
  id: string; // BIGINT: pg returns a string, never coerce to JS number
  guildId: string;
  kind: ScheduledKind;
  payload: ScheduledPayload;
  attempts: number;
  maxAttempts: number;
  leaseToken: string;
  leaseOwner: string;
  cancelRequested: boolean;
}

export type JobOutcome =
  | { outcome: 'completed' }
  | { outcome: 'canceled'; reasonCode: string }
  | { outcome: 'retry'; reasonCode: string }
  | { outcome: 'needs_review'; reasonCode: string }
  | { outcome: 'dead'; reasonCode: string };

export interface JobTransition {
  status: Exclude<JobStatus, 'running'>;
  reasonCode: string | null;
  retryDelaySeconds: number | null;
}

const SNOWFLAKE = /^\d{17,20}$/;
const KEY = /^[a-zA-Z0-9:_-]{1,128}$/;
const REASON = /^[a-z][a-z0-9_]{0,63}$/;
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function assertSnowflake(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SNOWFLAKE.test(value)) {
    throw new Error('Invalid ' + label);
  }
}

function assertNumber(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error('Invalid ' + label);
  }
}

function assertKeys(value: Record<string, unknown>, keys: string[]): void {
  const actual = Object.keys(value).sort();
  if (actual.join(',') !== [...keys].sort().join(',')) {
    throw new Error('Unexpected job payload fields');
  }
}

export function parseUtcInstant(value: unknown): Date {
  if (typeof value !== 'string' || !UTC_TIME.test(value)) {
    throw new Error('runAt must be an explicit UTC ISO-8601 timestamp ending in Z');
  }
  const date = new Date(value);
  const normalized = value.includes('.')
    ? value.replace(/\.(\d{1,3})Z$/, (_match, fraction: string) =>
        '.' + fraction.padEnd(3, '0') + 'Z')
    : value.replace(/Z$/, '.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) {
    throw new Error('Invalid UTC runAt timestamp');
  }
  return date;
}

export function normalizeJob(value: NewScheduledJob): Required<NewScheduledJob> {
  if (!value || typeof value !== 'object') throw new Error('Invalid job');
  assertSnowflake(value.guildId, 'guild ID');
  if (!SCHEDULED_KINDS.includes(value.kind)) throw new Error('Unsupported job kind');
  if (typeof value.idempotencyKey !== 'string' || !KEY.test(value.idempotencyKey)) {
    throw new Error('Invalid idempotency key');
  }
  parseUtcInstant(value.runAt);
  const maxAttempts = value.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error('Invalid maxAttempts');
  }
  assertScheduledPayload(value.kind, value.payload);
  const payload = value.payload;

  return {
    guildId: value.guildId,
    kind: value.kind,
    idempotencyKey: value.idempotencyKey,
    payload: { ...payload } as unknown as ScheduledPayload,
    runAt: value.runAt,
    maxAttempts,
  };
}

/**
 * Validate job contents on both write and read. The PostgreSQL JSONB check
 * enforces only that payload is an object, not its kind-specific shape.
 */
export function assertScheduledPayload(
  kind: ScheduledKind, raw: unknown,
): asserts raw is ScheduledPayload {
  if (!SCHEDULED_KINDS.includes(kind)) throw new Error('Unsupported job kind');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid job payload');
  }
  const payload = raw as Record<string, unknown>;
  switch (kind) {
    case 'temporary_unban':
      assertKeys(payload, ['targetUserId', 'moderationCaseId']);
      assertSnowflake(payload.targetUserId, 'target user ID');
      assertNumber(payload.moderationCaseId, 'moderation case ID');
      break;
    case 'reminder_send':
      assertKeys(payload, ['reminderId']);
      assertNumber(payload.reminderId, 'reminder ID');
      break;
    case 'giveaway_close':
      assertKeys(payload, ['giveawayId']);
      assertNumber(payload.giveawayId, 'giveaway ID');
      break;
    case 'event_notice':
      assertKeys(payload, ['eventId']);
      assertNumber(payload.eventId, 'event ID');
      break;
  }
}

/**
 * Database rows are NOT trusted merely because TypeScript declares the query
 * result a ClaimedJob. A corrupted/migrated row must never reach Discord.
 */
export function assertClaimedJob(value: unknown): asserts value is ClaimedJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid claimed job');
  }
  const job = value as Partial<ClaimedJob>;
  if (typeof job.id !== 'string' || !/^[1-9]\d{0,18}$/.test(job.id) ||
      BigInt(job.id) > 9223372036854775807n) {
    throw new Error('Invalid claimed job ID');
  }
  assertSnowflake(job.guildId, 'claimed guild ID');
  if (!job.kind || !SCHEDULED_KINDS.includes(job.kind)) {
    throw new Error('Unsupported claimed job kind');
  }
  assertScheduledPayload(job.kind, job.payload);
  if (!Number.isInteger(job.attempts) || !Number.isInteger(job.maxAttempts) ||
      (job.attempts as number) < 1 || (job.maxAttempts as number) < 1 ||
      (job.attempts as number) > (job.maxAttempts as number) ||
      (job.maxAttempts as number) > 10) {
    throw new Error('Invalid claimed job attempt count');
  }
  if (typeof job.leaseToken !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.leaseToken) ||
      typeof job.leaseOwner !== 'string' ||
      !/^[a-zA-Z0-9:_-]{1,80}$/.test(job.leaseOwner) ||
      typeof job.cancelRequested !== 'boolean') {
    throw new Error('Invalid claimed job lease');
  }
}

/** Deterministic bounded retry, with a tiny stable per-job spread. */
export function retryDelaySeconds(jobId: string, attempts: number): number {
  if (!/^[1-9]\d*$/.test(jobId) || !Number.isInteger(attempts) || attempts < 1) {
    throw new Error('Invalid retry parameters');
  }
  const seconds = Math.min(900, 5 * 2 ** Math.min(attempts - 1, 8));
  const jitter = Number(BigInt(jobId) % 11n);
  return Math.min(900, seconds + jitter);
}

export function transitionFor(
  jobId: string, attempts: number, maxAttempts: number, result: JobOutcome,
): JobTransition {
  if (!result || typeof result !== 'object') throw new Error('Invalid job outcome');
  if (!Number.isInteger(attempts) || !Number.isInteger(maxAttempts) ||
      attempts < 1 || maxAttempts < 1 || attempts > maxAttempts || maxAttempts > 10) {
    throw new Error('Invalid job attempt count');
  }
  if (result.outcome === 'completed') {
    return { status: 'completed', reasonCode: null, retryDelaySeconds: null };
  }
  if (typeof result.reasonCode !== 'string' || !REASON.test(result.reasonCode)) {
    throw new Error('Invalid job reason code');
  }
  switch (result.outcome) {
    case 'canceled':
      return { status: 'canceled', reasonCode: result.reasonCode, retryDelaySeconds: null };
    case 'needs_review':
      return { status: 'needs_review', reasonCode: result.reasonCode, retryDelaySeconds: null };
    case 'dead':
      return { status: 'dead', reasonCode: result.reasonCode, retryDelaySeconds: null };
    case 'retry':
      return attempts >= maxAttempts
        ? { status: 'dead', reasonCode: 'retry_exhausted', retryDelaySeconds: null }
        : { status: 'pending', reasonCode: result.reasonCode,
            retryDelaySeconds: retryDelaySeconds(jobId, attempts) };
    default:
      throw new Error('Unsupported job outcome');
  }
}
