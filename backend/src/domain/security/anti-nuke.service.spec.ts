import { AntiNukeService } from './anti-nuke.service';
import { DEFAULT_ANTI_NUKE_CONFIG } from './anti-nuke-policy';

describe('AntiNukeService durable event and alert lifecycle', () => {
  const guildId = '123456789012345678';
  const auditEntryId = '234567890123456789';
  const now = Date.UTC(2026, 9, 28, 17);
  const observation = {
    guildId, auditEntryId, kind: 'channel_delete' as const,
    actorId: '345678901234567890', targetId: '456789012345678901',
    eventAtMs: now - 200, observedAtMs: now,
  };
  const config = {
    ...DEFAULT_ANTI_NUKE_CONFIG, enabled: true,
    alertChannelId: '567890123456789012',
    exemptActorIds: [] as string[],
  };

  function setup() {
    const eventInsert = {
      insert: jest.fn().mockReturnThis(), into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(), orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [{ id: 7 }] }),
    };
    const alertInsert = {
      insert: jest.fn().mockReturnThis(), into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(), orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [{ id: 11 }] }),
    };
    const settings = {
      findOne: jest.fn().mockResolvedValue(config),
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
    };
    const events = {
      createQueryBuilder: jest.fn().mockReturnValue(eventInsert),
      count: jest.fn().mockResolvedValue(3),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const alerts = {
      createQueryBuilder: jest.fn().mockReturnValue(alertInsert),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    return {
      service: new AntiNukeService(settings as any, events as any, alerts as any),
      settings, events, alerts, eventInsert, alertInsert,
    };
  }

  it('does not write events when disabled or audit time is stale', async () => {
    const a = setup();
    a.settings.findOne.mockResolvedValue({ ...config, enabled: false });
    expect(await a.service.observe(observation)).toBeNull();
    expect(a.events.createQueryBuilder).not.toHaveBeenCalled();
    const b = setup();
    expect(await b.service.observe({
      ...observation, eventAtMs: now - 31000,
    })).toBeNull();
    expect(b.events.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('exempts only known audit executor IDs before recording', async () => {
    const a = setup();
    a.settings.findOne.mockResolvedValue({
      ...config, exemptActorIds: [observation.actorId],
    });
    expect(await a.service.observe(observation)).toBeNull();
    expect(a.events.createQueryBuilder).not.toHaveBeenCalled();
    const b = setup();
    b.settings.findOne.mockResolvedValue({
      ...config, exemptActorIds: [observation.actorId],
    });
    expect(await b.service.observe({ ...observation, actorId: null }))
      .not.toBeNull();
  });

  it('deduplicates by exact Discord audit entry ID before counting', async () => {
    const a = setup();
    const result = await a.service.observe(observation);
    expect(result).toEqual({
      guildId, alertId: 11, alertChannelId: config.alertChannelId,
      eventCount: 3, windowSeconds: 60, triggeredBy: 'channel_delete',
    });
    expect(a.eventInsert.values).toHaveBeenCalledWith({
      guildId, auditEntryId, kind: 'channel_delete',
      actorId: observation.actorId, targetId: observation.targetId,
      eventAt: new Date(observation.eventAtMs),
    });
    expect(a.events.count).toHaveBeenCalledWith({
      where: { guildId, eventAt: expect.anything() },
    });
    expect(a.alertInsert.orIgnore).toHaveBeenCalled();
  });

  it('does not alert again for a duplicated audit event or existing bucket', async () => {
    const a = setup();
    a.eventInsert.execute.mockResolvedValue({ raw: [] });
    expect(await a.service.observe(observation)).toBeNull();
    expect(a.events.count).not.toHaveBeenCalled();
    expect(a.alertInsert.execute).not.toHaveBeenCalled();
    const b = setup();
    b.alertInsert.execute.mockResolvedValue({ raw: [] });
    expect(await b.service.observe(observation)).toBeNull();
  });

  it('records below-threshold events without sending alerts', async () => {
    const a = setup();
    a.events.count.mockResolvedValue(2);
    expect(await a.service.observe(observation)).toBeNull();
    expect(a.alertInsert.execute).not.toHaveBeenCalled();
  });

  it('isolates configuration updates to guild and rejects malformed writes', async () => {
    const a = setup();
    await expect(a.service.setConfig(guildId, {
      ...DEFAULT_ANTI_NUKE_CONFIG, mode: 'lockdown',
    })).rejects.toThrow('alert_only');
    expect(a.settings.save).not.toHaveBeenCalled();
    await a.service.setConfig(guildId, {
      ...config, exemptActorIds: ['345678901234567890', '345678901234567890'],
    });
    expect(a.settings.save).toHaveBeenCalledWith(expect.objectContaining({
      guildId, mode: 'alert_only',
      exemptActorIds: ['345678901234567890'],
    }));
    await a.service.getConfig('678901234567890123');
    expect(a.settings.findOne).toHaveBeenCalledWith({
      where: { guildId: '678901234567890123' },
    });
  });

  it('conditionally finalizes only a pending guild-owned alert', async () => {
    const a = setup();
    await a.service.finishAlert(guildId, 11, 'sent');
    expect(a.alerts.update).toHaveBeenCalledWith(
      { guildId, id: 11, status: 'pending' },
      expect.objectContaining({ status: 'sent', deliveredAt: expect.any(Date) }),
    );
    await a.service.finishAlert(guildId, 11, 'missing_permissions');
    expect(a.alerts.update).toHaveBeenCalledWith(
      { guildId, id: 11, status: 'pending' },
      { status: 'failed', failureReason: 'missing_permissions' },
    );
    await expect(a.service.finishAlert(guildId, 0, 'sent'))
      .rejects.toThrow('completion');
  });

  it('allows only a single explicit manager review per alert', async () => {
    const a = setup();
    await a.service.reviewAlert(guildId, 11, '345678901234567890', 'legitimate');
    expect(a.alerts.update).toHaveBeenCalledWith(
      { guildId, id: 11, reviewedAt: expect.anything() },
      expect.objectContaining({
        reviewedById: '345678901234567890',
        disposition: 'legitimate',
        reviewedAt: expect.any(Date),
      }),
    );
    await expect(a.service.reviewAlert(guildId, 11, 'not-id', 'suspicious'))
      .rejects.toThrow('review');
    await expect(a.service.reviewAlert(guildId, 11, '345678901234567890', 'ban' as any))
      .rejects.toThrow('review');
  });

  it('reads only current guild audit history, and opportunistically prunes stale rows', async () => {
    const a = setup();
    await a.service.recentAlerts(guildId);
    expect(a.alerts.find).toHaveBeenCalledWith({
      where: { guildId }, order: { createdAt: 'DESC', id: 'DESC' }, take: 20,
    });
    await a.service.observe(observation);
    expect(a.events.delete).toHaveBeenCalledWith({
      guildId, eventAt: expect.anything(),
    });
    expect(a.alerts.delete).toHaveBeenCalledWith({
      guildId, createdAt: expect.anything(),
    });
    await a.service.observe(observation);
    expect(a.events.delete).toHaveBeenCalledTimes(1);
  });
});
