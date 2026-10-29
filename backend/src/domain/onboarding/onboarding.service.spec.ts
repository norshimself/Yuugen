import { OnboardingService } from './onboarding.service';

describe('OnboardingService: durable delivery receipts (#62)', () => {
  const guildId = '123456789012345678';
  const userId = '234567890123456789';
  const now = Date.UTC(2026, 9, 29, 13);
  const sessionKey = String(now);

  function setup() {
    const insert = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [{ id: 17 }] }),
    };
    const receipts = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn().mockReturnValue(insert),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    return {
      receipts, insert,
      service: new OnboardingService(receipts as any),
    };
  }

  it('reserves stable guild/session keys before a public send', async () => {
    const x = setup();
    expect(await x.service.reserve(
      guildId, userId, 'welcome', sessionKey, now,
    )).toBe(17);
    expect(x.insert.values).toHaveBeenCalledWith({
      guildId, userId, kind: 'welcome', sessionKey,
      occurredAt: new Date(now), minuteBucket: new Date(now),
      slot: 0, status: 'pending', failureReason: null,
      deliveredAt: null, acknowledgedAt: null,
    });
    expect(x.insert.orIgnore).toHaveBeenCalled();
  });

  it('rejects invalid identifiers and session keys without a DB claim', async () => {
    const x = setup();
    expect(await x.service.reserve(guildId, 'invalid',
      'welcome', sessionKey, now)).toBeNull();
    expect(await x.service.reserve(guildId, userId,
      'welcome', 'bad', now)).toBeNull();
    expect(await x.service.reserve(guildId, userId,
      'welcome', sessionKey, Number.NaN)).toBeNull();
    expect(x.receipts.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('deduplicates gateway replay for public welcome or goodbye', async () => {
    const x = setup();
    x.receipts.findOne.mockResolvedValueOnce({ id: 17 });
    expect(await x.service.reserve(
      guildId, userId, 'welcome', sessionKey, now,
    )).toBeNull();
    expect(x.insert.execute).not.toHaveBeenCalled();
  });

  it('sends a first-time DM once per guild across re-joins and bot restarts', async () => {
    const x = setup();
    x.receipts.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 4, kind: 'welcome_dm' });
    expect(await x.service.reserve(
      guildId, userId, 'welcome_dm', sessionKey, now,
    )).toBeNull();
    expect(x.insert.execute).not.toHaveBeenCalled();
  });

  it('lets a competing worker win only one DB claim for the same DM', async () => {
    const x = setup();
    x.insert.execute.mockResolvedValueOnce({ raw: [] });
    x.receipts.findOne
      .mockResolvedValueOnce(null) // pre-check same session
      .mockResolvedValueOnce(null) // pre-check existing first DM
      .mockResolvedValueOnce(null) // post-insert same session
      .mockResolvedValueOnce({ id: 4, kind: 'welcome_dm' }); // first-DM index
    expect(await x.service.reserve(
      guildId, userId, 'welcome_dm', sessionKey, now,
    )).toBeNull();
    expect(x.insert.execute).toHaveBeenCalledTimes(1);
  });

  it('enforces a DB-wide 30/minute capacity across all event types', async () => {
    const x = setup();
    x.insert.execute.mockResolvedValue({ raw: [] });
    expect(await x.service.reserve(
      guildId, userId, 'welcome', sessionKey, now,
    )).toBeNull();
    expect(x.insert.execute).toHaveBeenCalledTimes(30);
    expect(await x.service.reserve(
      guildId, '345678901234567890', 'goodbye', sessionKey, now,
    )).toBeNull();
    expect(x.insert.execute).toHaveBeenCalledTimes(30);
  });

  it('finishes only a pending guild-owned send and keeps ambiguous sends pending', async () => {
    const x = setup();
    await x.service.finish(guildId, 17, 'sent');
    expect(x.receipts.update).toHaveBeenCalledWith(
      { guildId, id: 17, status: 'pending' },
      expect.objectContaining({ status: 'sent', deliveredAt: expect.any(Date) }),
    );
    await x.service.finish(guildId, 17, 'dm_unavailable');
    expect(x.receipts.update).toHaveBeenCalledWith(
      { guildId, id: 17, status: 'pending' },
      { status: 'failed', failureReason: 'dm_unavailable' },
    );
    await x.service.finish(guildId, 17, 'config_changed');
    expect(x.receipts.update).toHaveBeenCalledWith(
      { guildId, id: 17, status: 'pending' },
      { status: 'failed', failureReason: 'config_changed' },
    );
    await expect(x.service.finish(guildId, 0, 'sent'))
      .rejects.toThrow('Invalid onboarding result');
  });

  it('acknowledges only one user-bound pending or sent first-DM receipt', async () => {
    const x = setup();
    expect(await x.service.acknowledge(guildId, userId, sessionKey)).toBe(true);
    expect(x.receipts.update).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId, userId, sessionKey, kind: 'welcome_dm',
        acknowledgedAt: expect.anything(), status: expect.anything(),
      }),
      { acknowledgedAt: expect.any(Date) },
    );
    x.receipts.update.mockResolvedValueOnce({ affected: 0 });
    expect(await x.service.acknowledge(guildId, userId, sessionKey)).toBe(false);
    expect(await x.service.acknowledge(guildId, 'bad', sessionKey)).toBe(false);
  });

  it('prunes public receipts only, preserving DM dedup records', async () => {
    const x = setup();
    await x.service.reserve(guildId, userId, 'welcome', sessionKey, now);
    expect(x.receipts.delete).toHaveBeenCalledWith({
      guildId, kind: expect.anything(), createdAt: expect.anything(),
    });
    const [, arg] = [...x.receipts.delete.mock.calls[0][0].kind.value];
    expect(x.receipts.delete.mock.calls[0][0].kind.value).toEqual([
      'welcome', 'goodbye',
    ]);
  });
});
