import {
  DISCORD_SNOWFLAKE,
  MAX_PURGE_COUNT,
  MAX_SCAN_MESSAGES,
} from '../../../domain/moderation/purge-constraints';

export { DISCORD_SNOWFLAKE, MAX_PURGE_COUNT, MAX_SCAN_MESSAGES };
export const BULK_DELETE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const PURGE_AGE_SAFETY_BUFFER_MS = 5 * 60 * 1000;

export interface PurgeMessage {
  id: string;
  author: { id: string };
  createdTimestamp: number;
  pinned: boolean;
  deletable?: boolean;
  system?: boolean;
}

export interface PurgePage<T extends PurgeMessage> {
  size: number;
  values(): IterableIterator<T>;
}

export interface PurgeMessageSource<T extends PurgeMessage> {
  messages: {
    fetch(options: {
      limit: number;
      before?: string;
      cache: false;
    }): Promise<PurgePage<T>>;
  };
}

export interface PurgePlan<T extends PurgeMessage> {
  messages: T[];
  scannedCount: number;
  skippedOldCount: number;
  skippedProtectedCount: number;
  scanLimitReached: boolean;
}

export interface PurgePermissions {
  actorCanView: boolean;
  actorCanManage: boolean;
  botCanView: boolean;
  botCanReadHistory: boolean;
  botCanManage: boolean;
}

export function getPurgeDenial(input: PurgePermissions): string | null {
  if (!input.actorCanView || !input.actorCanManage) {
    return 'You need View Channel and Manage Messages in the target channel.';
  }
  if (!input.botCanView || !input.botCanManage || !input.botCanReadHistory) {
    return 'Yuugen needs View Channel, Read Message History and Manage Messages in the target channel.';
  }
  return null;
}

export function validatePurgeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= 1 && value <= MAX_PURGE_COUNT
    ? value : null;
}

/**
 * Fetch at most 500 *recent* messages (five 100-message REST pages) to
 * select at most 100 matching messages. No message content is accessed.
 * Discord rejects bulk deletes of messages older than 14 days; a five-minute
 * buffer protects the selection from expiring while the user confirms.
 * Pinned, system, and explicitly nondeletable messages are never selected.
 */
export async function buildPurgePlan<T extends PurgeMessage>(
  source: PurgeMessageSource<T>,
  requestedCount: number,
  filterUserId: string | null,
  now = Date.now(),
): Promise<PurgePlan<T>> {
  if (validatePurgeCount(requestedCount) === null) {
    throw new Error('Invalid purge count');
  }
  if (filterUserId !== null && !DISCORD_SNOWFLAKE.test(filterUserId)) {
    throw new Error('Invalid purge user ID');
  }
  const cutoff = now - BULK_DELETE_AGE_MS + PURGE_AGE_SAFETY_BUFFER_MS;
  const messages: T[] = [];
  const seen = new Set<string>();
  let before: string | undefined;
  let scannedCount = 0;
  let skippedOldCount = 0;
  let skippedProtectedCount = 0;
  let scanLimitReached = false;

  for (let pageNumber = 0; pageNumber < MAX_SCAN_MESSAGES / 100; pageNumber++) {
    const fetched = await source.messages.fetch({
      limit: 100,
      before,
      cache: false,
    });
    const batch = Array.from(fetched.values()).sort(
      (a, b) => b.createdTimestamp - a.createdTimestamp ||
        (BigInt(b.id) > BigInt(a.id) ? 1 : -1),
    );
    if (batch.length === 0) break;

    let reachedOld = false;
    for (const message of batch) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      scannedCount++;
      if (message.createdTimestamp <= cutoff) {
        skippedOldCount++;
        reachedOld = true;
        break;
      }
      if (message.pinned || message.system === true ||
          message.deletable === false) {
        skippedProtectedCount++;
        continue;
      }
      if (filterUserId !== null && message.author?.id !== filterUserId) {
        continue;
      }
      messages.push(message);
      if (messages.length === requestedCount) break;
    }
    if (messages.length === requestedCount || reachedOld) break;
    if (batch.length < 100) break;

    const oldestId = batch[batch.length - 1].id;
    if (oldestId === before) break;
    before = oldestId;
    if (pageNumber === MAX_SCAN_MESSAGES / 100 - 1) {
      scanLimitReached = true;
    }
  }

  return {
    messages,
    scannedCount,
    skippedOldCount,
    skippedProtectedCount,
    scanLimitReached,
  };
}

export function samePurgeSelection(
  original: readonly string[],
  refreshed: readonly string[],
): boolean {
  return original.length === refreshed.length &&
    original.every((id, i) => id === refreshed[i]);
}
