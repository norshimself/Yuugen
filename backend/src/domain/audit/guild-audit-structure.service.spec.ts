import { GuildAuditService } from './guild-audit.service';

describe('GuildAuditService: structural events and retention (#61)', () => {
  const guildId = '123456789012345678';
  const actorId = '234567890123456789';
  const eventId = '345678901234567890';
  const now = Date.UTC(2026, 9, 29, 12, 45);
  const config = {
    enabled: true, logChannelId: '456789012345678901',
    selectedEvents: ['role_update', 'role_create', 'permission_change'],
    retentionDays: 3,
  };
  const input = {
    guildId,
    eventType: 'role_update' as const,
    eventId,
    revision: 0,
    occurredAtMs: now - 8 * 60000,
    observedAtMs: now,
    targetId: eventId,
    sourceChannelId: null,
    actorId,
    verifiedAuditEntry: true,
    changedFields: ['token', 'name', 'name', 'topic', 'reason'],
  };

  function setup() {
    const builder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [{
        id: 11, targetId: eventId, sourceChannelId: null,
        actorId, changedFields: ['name', 'topic'],
      }] }),
    };
    const configs = {
      findOne: jest.fn().mockResolvedValue(config),
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown) => x),
    };
    const events = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn().mockReturnValue(builder),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    return {
      service: new GuildAuditService(configs as any, events as any),
      configs, events, builder,
    };
  }

  it('persists only validated field labels and audited actor ID, never raw values', async () => {
    const x = setup();
    expect(await x.service.reserve(input)).toEqual({
      id: 11, guildId, eventType: 'role_update', logChannelId: config.logChannelId,
      targetId: eventId, sourceChannelId: null,
      actorId, changedFields: ['name', 'topic'],
    });
    expect(x.builder.values).toHaveBeenCalledWith(expect.objectContaining({
      guildId, actorId, changedFields: ['name', 'topic'],
      eventKey: 'role_update:' + eventId + ':0',
      occurredAt: new Date(now - 8 * 60000),
      minuteBucket: new Date(now),
    }));
    expect(JSON.stringify(x.builder.values.mock.calls)).not.toContain('token');
    expect(JSON.stringify(x.builder.values.mock.calls)).not.toContain('reason');
  });

  it('requires explicit verified audit provenance for structural events', async () => {
    const x = setup();
    expect(await x.service.reserve({ ...input, verifiedAuditEntry: false })).toBeNull();
    expect(await x.service.reserve({ ...input, verifiedAuditEntry: undefined })).toBeNull();
    expect(x.events.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('accepts bounded delayed audit events; rejects stale and future entries', async () => {
    const x = setup();
    expect(await x.service.reserve({
      ...input, occurredAtMs: now - 10 * 60000,
    })).not.toBeNull();
    const stale = setup();
    expect(await stale.service.reserve({
      ...input, occurredAtMs: now - 10 * 60000 - 1,
    })).toBeNull();
    const future = setup();
    expect(await future.service.reserve({
      ...input, occurredAtMs: now + 5001,
    })).toBeNull();
    expect(stale.events.createQueryBuilder).not.toHaveBeenCalled();
    expect(future.events.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('retains ordinary message event 2-minute limit instead of audit 10-minute limit', async () => {
    const x = setup();
    x.configs.findOne.mockResolvedValue({ ...config,
      selectedEvents: ['message_delete'] });
    expect(await x.service.reserve({ ...input, eventType: 'message_delete' }))
      .toBeNull();
    expect(x.events.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('deduplicates out-of-order audit entries by their actual Discord audit IDs', async () => {
    const x = setup();
    x.events.findOne.mockResolvedValueOnce({ id: 55 });
    expect(await x.service.reserve(input)).toBeNull();
    expect(x.events.findOne).toHaveBeenCalledWith({
      where: { guildId, eventKey: 'role_update:' + eventId + ':0' },
    });
    expect(x.builder.execute).not.toHaveBeenCalled();
  });

  it('does not record structural changes to its own audit channel', async () => {
    const x = setup();
    expect(await x.service.reserve({ ...input,
      eventType: 'permission_change',
      sourceChannelId: config.logChannelId,
    })).toBeNull();
    expect(x.builder.execute).not.toHaveBeenCalled();
  });

  it('applies configured 3-day retention and stays guild-scoped', async () => {
    const x = setup();
    await x.service.reserve(input);
    expect(x.events.delete).toHaveBeenCalledTimes(1);
    const [where] = x.events.delete.mock.calls[0];
    expect(where.guildId).toBe(guildId);
    expect(where.createdAt.value).toEqual(new Date(now - 3 * 24 * 3600000));
  });

  it('filters historical audit rows at read time even when cleanup has not run', async () => {
    const x = setup();
    const before = Date.now();
    await x.service.history(guildId);
    const after = Date.now();
    expect(x.events.find).toHaveBeenCalledTimes(1);
    const where = x.events.find.mock.calls[0][0].where;
    expect(where.guildId).toBe(guildId);
    const cutoff = where.createdAt.value.getTime();
    const retention = 3 * 24 * 3600000;
    expect(cutoff).toBeGreaterThanOrEqual(before - retention);
    expect(cutoff).toBeLessThanOrEqual(after - retention);
  });

  it('defaults retention to seven days for old API request payloads', async () => {
    const x = setup();
    await x.service.setConfig(guildId, {
      enabled: true, logChannelId: config.logChannelId,
      selectedEvents: ['role_create'],
    });
    expect(x.configs.save).toHaveBeenCalledWith(expect.objectContaining({
      guildId, retentionDays: 7,
    }));
    await expect(x.service.setConfig(guildId, {
      enabled: true, logChannelId: config.logChannelId,
      selectedEvents: ['role_create'], retentionDays: 31,
    })).rejects.toThrow('Retention');
  });

  it('honors database rate limiting and never retries a replayed audit ID', async () => {
    const x = setup();
    x.builder.execute.mockResolvedValue({ raw: [] });
    await x.service.reserve(input);
    expect(x.builder.execute).toHaveBeenCalledTimes(20);
    // Another worker had already persisted this audit event.
    const y = setup();
    y.events.findOne.mockResolvedValue({ id: 11 });
    expect(await y.service.reserve(input)).toBeNull();
    expect(y.builder.execute).not.toHaveBeenCalled();
  });
});
