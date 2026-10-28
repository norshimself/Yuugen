import {
  buildPurgePlan,
  getPurgeDenial,
  samePurgeSelection,
  validatePurgeCount,
  BULK_DELETE_AGE_MS,
  MAX_PURGE_COUNT,
} from './purge-policy';

const now = Date.UTC(2026, 9, 28, 12, 0, 0);
const alice = '123456789012345678';
const bob = '234567890123456789';
type FakeMessage = {
  id: string;
  author: { id: string };
  createdTimestamp: number;
  pinned: boolean;
  deletable?: boolean;
  system?: boolean;
};

function makeMessage(n: number, opts: Partial<FakeMessage> = {}): FakeMessage {
  return {
    id: String(BigInt('123456789012345678') + BigInt(n)),
    author: { id: alice },
    createdTimestamp: now - n * 1000,
    pinned: false,
    ...opts,
  };
}

function source(messages: FakeMessage[]) {
  const sorted = [...messages].sort((a, b) =>
    BigInt(a.id) > BigInt(b.id) ? -1 : 1,
  );
  const calls: Array<{ limit: number; before?: string; cache: false }> = [];
  const channel = {
    messages: {
      fetch: jest.fn(async (options: {
        limit: number; before?: string; cache: false;
      }) => {
        calls.push(options);
        const usable = sorted.filter(m => !options.before ||
          BigInt(m.id) < BigInt(options.before));
        return new Map(usable.slice(0, options.limit).map(m => [m.id, m]));
      }),
    },
  };
  return { channel, calls };
}

describe('purge policy and bounded selection', () => {
  it('requires View Channel/Manage Messages for the moderator', () => {
    expect(getPurgeDenial({
      actorCanView: false, actorCanManage: true,
      botCanView: true, botCanReadHistory: true, botCanManage: true,
    })).toContain('You need');
    expect(getPurgeDenial({
      actorCanView: true, actorCanManage: false,
      botCanView: true, botCanReadHistory: true, botCanManage: true,
    })).toContain('Manage Messages');
  });

  it('requires View/Read History/Manage Messages for the bot', () => {
    for (const missing of ['botCanView', 'botCanReadHistory', 'botCanManage'] as const) {
      expect(getPurgeDenial({
        actorCanView: true, actorCanManage: true,
        botCanView: true, botCanReadHistory: true, botCanManage: true,
        [missing]: false,
      })).toContain('Yuugen needs');
    }
    expect(getPurgeDenial({
      actorCanView: true, actorCanManage: true,
      botCanView: true, botCanReadHistory: true, botCanManage: true,
    })).toBeNull();
  });

  it('accepts only counts from 1 through 100', () => {
    expect(validatePurgeCount(1)).toBe(1);
    expect(validatePurgeCount(MAX_PURGE_COUNT)).toBe(MAX_PURGE_COUNT);
    for (const n of [0, 101, 1.5, NaN, Infinity, -1, '10', null]) {
      expect(validatePurgeCount(n)).toBeNull();
    }
  });

  it('selects only the requested number and fetches without using cached messages', async () => {
    const { channel, calls } = source(Array.from({ length: 25 }, (_, i) => makeMessage(i + 1)));
    const plan = await buildPurgePlan(channel, 10, null, now);
    expect(plan.messages).toHaveLength(10);
    expect(plan.scannedCount).toBe(10);
    expect(calls).toEqual([{ limit: 100, before: undefined, cache: false }]);
  });

  it('filters by author ID without reading message contents', async () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      makeMessage(i + 1, { author: { id: i % 2 ? bob : alice } }));
    const { channel } = source(messages);
    const plan = await buildPurgePlan(channel, 4, bob, now);
    expect(plan.messages).toHaveLength(4);
    expect(plan.messages.every(m => m.author.id === bob)).toBe(true);
  });

  it('skips pinned, system and explicitly nondeletable messages', async () => {
    const m = [
      makeMessage(1, { pinned: true }),
      makeMessage(2, { system: true }),
      makeMessage(3, { deletable: false }),
      makeMessage(4),
    ];
    const plan = await buildPurgePlan(source(m).channel, 4, null, now);
    expect(plan.messages).toHaveLength(1);
    expect(plan.skippedProtectedCount).toBe(3);
  });

  it('stops at two-week cutoff with a safety buffer', async () => {
    const m = [
      makeMessage(1),
      makeMessage(2, { createdTimestamp: now - BULK_DELETE_AGE_MS + 60_000 }),
      makeMessage(3, { createdTimestamp: now - BULK_DELETE_AGE_MS - 1000 }),
    ];
    const plan = await buildPurgePlan(source(m).channel, 10, null, now);
    expect(plan.messages.map(x => x.id)).toEqual([m[0].id]);
    expect(plan.skippedOldCount).toBe(1);
  });

  it('paginates by before cursor and never scans more than 500 messages', async () => {
    const messages = Array.from({ length: 550 }, (_, i) =>
      makeMessage(i + 1, { author: { id: alice } }));
    const { channel, calls } = source(messages);
    const plan = await buildPurgePlan(channel, 100, bob, now);
    expect(plan.messages).toHaveLength(0);
    expect(plan.scannedCount).toBe(500);
    expect(plan.scanLimitReached).toBe(true);
    expect(calls).toHaveLength(5);
    expect(calls[1].before).toBeDefined();
  });

  it('does not scan beyond exhausted history', async () => {
    const { channel, calls } = source([makeMessage(1), makeMessage(2)]);
    const plan = await buildPurgePlan(channel, 4, bob, now);
    expect(plan.messages).toHaveLength(0);
    expect(plan.scanLimitReached).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('rejects invalid filter IDs and counts before requesting messages', async () => {
    const { channel } = source([]);
    await expect(buildPurgePlan(channel, 0, null, now))
      .rejects.toThrow('Invalid purge count');
    await expect(buildPurgePlan(channel, 1, 'not-an-id', now))
      .rejects.toThrow('Invalid purge user ID');
    expect(channel.messages.fetch).not.toHaveBeenCalled();
  });

  it('compares complete ordered selections rather than only counts', () => {
    expect(samePurgeSelection(['1', '2'], ['1', '2'])).toBe(true);
    expect(samePurgeSelection(['1', '2'], ['2', '1'])).toBe(false);
    expect(samePurgeSelection(['1', '2'], ['1', '3'])).toBe(false);
    expect(samePurgeSelection(['1', '2'], ['1'])).toBe(false);
  });
});
