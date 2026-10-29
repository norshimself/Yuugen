import { GuildAuditService } from './guild-audit.service';
import { DEFAULT_GUILD_AUDIT } from './guild-audit-policy';

describe('GuildAuditService: scoped persistence and DB rate limiting', () => {
  const guildId = '123456789012345678';
  const targetId = '234567890123456789';
  const now = Date.UTC(2026, 9, 29, 12, 30);
  const enabled = {
    enabled: true, logChannelId: '345678901234567890',
    selectedEvents: ['message_delete', 'member_kick'],
  };
  const input = {
    guildId, eventType: 'message_delete' as const,
    eventId: targetId, revision: 0, sourceChannelId: '456789012345678901',
    targetId, actorId: '567890123456789012',
    occurredAtMs: now, observedAtMs: now,
  };

  function setup() {
    const insert = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [{
        id: 12, targetId, sourceChannelId: input.sourceChannelId, actorId: null,
      }] }),
    };
    const configs = {
      findOne: jest.fn().mockResolvedValue(enabled),
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown) => x),
    };
    const events = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn().mockReturnValue(insert),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    return {
      service: new GuildAuditService(configs as any, events as any),
      configs, events, insert,
    };
  }

  it('does not save when disabled, unselected or aimed at the audit destination', async () => {
    const a = setup();
    a.configs.findOne.mockResolvedValue(DEFAULT_GUILD_AUDIT);
    expect(await a.service.reserve(input)).toBeNull();
    expect(a.events.createQueryBuilder).not.toHaveBeenCalled();

    const b = setup();
    expect(await b.service.reserve({ ...input, eventType: 'member_join' })).toBeNull();
    expect(b.events.createQueryBuilder).not.toHaveBeenCalled();

    const c = setup();
    expect(await c.service.reserve({
      ...input, sourceChannelId: enabled.logChannelId,
    })).toBeNull();
    expect(c.events.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('rejects untrusted IDs and timestamps before database side effects', async () => {
    const a = setup();
    expect(await a.service.reserve({ ...input, eventId: 'invalid' })).toBeNull();
    expect(await a.service.reserve({ ...input, occurredAtMs: now - 121000 }))
      .toBeNull();
    expect(await a.service.reserve({ ...input, targetId: 'invalid' })).toBeNull();
    expect(a.events.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('deduplicates repeat events across reconnects before allocating slots', async () => {
    const a = setup();
    a.events.findOne.mockResolvedValue({ id: 55 });
    expect(await a.service.reserve(input)).toBeNull();
    expect(a.events.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('reserves a database minute slot and never trusts inferred actor IDs', async () => {
    const a = setup();
    const result = await a.service.reserve(input);
    expect(result).toEqual({
      id: 12, guildId, logChannelId: enabled.logChannelId,
      eventType: 'message_delete', sourceChannelId: input.sourceChannelId,
      targetId, actorId: null,
    });
    expect(a.insert.values).toHaveBeenCalledWith(expect.objectContaining({
      guildId, eventKey: 'message_delete:' + targetId + ':0',
      minuteBucket: new Date(now), slot: 0, actorId: null,
      status: 'pending',
    }));
    expect(a.insert.orIgnore).toHaveBeenCalled();
  });

  it('retries a contested slot but stops after the DB rate ceiling', async () => {
    const a = setup();
    a.insert.execute.mockResolvedValue({ raw: [] });
    expect(await a.service.reserve(input)).toBeNull();
    expect(a.insert.execute).toHaveBeenCalledTimes(20);
    // Saturated guild does not hammer the DB on later events in same minute.
    expect(await a.service.reserve({ ...input, eventId: '678901234567890123' }))
      .toBeNull();
    expect(a.insert.execute).toHaveBeenCalledTimes(20);
  });

  it('preserves the actual Discord audit actor only on verified kick events', async () => {
    const a = setup();
    a.configs.findOne.mockResolvedValue({
      ...enabled, selectedEvents: ['member_kick'],
    });
    await a.service.reserve({
      ...input, eventType: 'member_kick', actorId: '567890123456789012',
    });
    expect(a.insert.values).toHaveBeenCalledWith(expect.objectContaining({
      actorId: '567890123456789012',
    }));
  });

  it('supports immediate guild-scoped configuration changes and fresh reads', async () => {
    const a = setup();
    await a.service.getConfig(guildId);
    await a.service.getConfig(guildId);
    expect(a.configs.findOne).toHaveBeenCalledTimes(1);
    await a.service.getConfig(guildId, true);
    expect(a.configs.findOne).toHaveBeenCalledTimes(2);
    await a.service.setConfig(guildId, {
      enabled: false, logChannelId: null, selectedEvents: [],
    });
    expect(a.configs.save).toHaveBeenCalledWith(expect.objectContaining({
      guildId, enabled: false,
    }));
    await expect(a.service.setConfig(guildId, {
      enabled: true, logChannelId: null, selectedEvents: [],
    })).rejects.toThrow('requires');
  });

  it('stores delivery outcomes only for matching pending guild events', async () => {
    const a = setup();
    await a.service.finish(guildId, 12, 'sent');
    expect(a.events.update).toHaveBeenCalledWith(
      { guildId, id: 12, status: 'pending' },
      expect.objectContaining({ status: 'sent', deliveredAt: expect.any(Date) }),
    );
    await a.service.finish(guildId, 12, 'config_changed');
    expect(a.events.update).toHaveBeenCalledWith(
      { guildId, id: 12, status: 'pending' },
      { status: 'failed', failureReason: 'config_changed' },
    );
    await expect(a.service.finish(guildId, 0, 'sent')).rejects.toThrow('Invalid');
  });

  it('prunes expired metadata opportunistically and exposes manager history', async () => {
    const a = setup();
    await a.service.reserve(input);
    expect(a.events.delete).toHaveBeenCalledWith({
      guildId, createdAt: expect.anything(),
    });
    await a.service.history(guildId);
    expect(a.events.find).toHaveBeenCalledWith({
      where: { guildId, createdAt: expect.anything() },
      order: { createdAt: 'DESC', id: 'DESC' }, take: 30,
    });
  });
});
