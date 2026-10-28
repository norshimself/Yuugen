import { AntiRaidService } from './anti-raid.service';
import { DEFAULT_ANTI_RAID_CONFIG } from './anti-raid-policy';

describe('AntiRaidService durability and guild scope', () => {
  const guildId = '123456789012345678';
  const userId = '234567890123456789';
  const joinedAtMs = Date.UTC(2026, 9, 28, 17);
  const valid = {
    guildId, userId, joinedAtMs, observedAtMs: joinedAtMs + 1000,
    accountCreatedAtMs: joinedAtMs - 10 * 60000, roleIds: [] as string[],
  };
  function setup() {
    const config = {
      ...DEFAULT_ANTI_RAID_CONFIG, enabled: true,
      alertChannelId: '345678901234567890',
      exemptRoleIds: [], exemptUserIds: [],
    };
    const joinInsert = {
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
      create: jest.fn((x: unknown) => x), save: jest.fn(async (x: unknown) => x),
    };
    const joins = {
      createQueryBuilder: jest.fn().mockReturnValue(joinInsert),
      count: jest.fn().mockResolvedValue(10),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const alerts = {
      createQueryBuilder: jest.fn().mockReturnValue(alertInsert),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    return {
      config, settings, joins, alerts, joinInsert, alertInsert,
      service: new AntiRaidService(settings as any, joins as any, alerts as any),
    };
  }

  it('does not persist joins for a disabled guild', async () => {
    const { settings, joins, service, config } = setup();
    settings.findOne.mockResolvedValue({ ...config, enabled: false });
    expect(await service.observeJoin(valid)).toBeNull();
    expect(joins.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('inserts a unique event before counting and reserves an alert bucket', async () => {
    const { service, joins, joinInsert, alertInsert } = setup();
    expect(await service.observeJoin(valid)).toMatchObject({
      guildId, alertId: 11, joinCount: 10, windowSeconds: 60,
    });
    expect(joinInsert.orIgnore).toHaveBeenCalled();
    expect(joinInsert.values).toHaveBeenCalledWith({
      guildId, userId, joinedAt: new Date(joinedAtMs),
    });
    expect(joins.count).toHaveBeenCalledWith({
      where: { guildId, joinedAt: expect.anything() },
    });
    expect(alertInsert.values).toHaveBeenCalledWith(expect.objectContaining({
      guildId, status: 'pending', joinCount: 10, windowSeconds: 60,
    }));
    expect(alertInsert.orIgnore).toHaveBeenCalled();
  });

  it('never alerts twice for duplicate gateway join events', async () => {
    const { service, joins, alerts, joinInsert } = setup();
    joinInsert.execute.mockResolvedValue({ raw: [] });
    expect(await service.observeJoin(valid)).toBeNull();
    expect(joins.count).not.toHaveBeenCalled();
    expect(alerts.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('allows the database unique bucket index to suppress simultaneous workers', async () => {
    const { service, alertInsert } = setup();
    alertInsert.execute.mockResolvedValue({ raw: [] });
    expect(await service.observeJoin(valid)).toBeNull();
  });

  it('does not alert for old accounts or legitimate below-threshold join waves', async () => {
    const { service, joins, alerts } = setup();
    joins.count.mockResolvedValue(9);
    expect(await service.observeJoin(valid)).toBeNull();
    expect(alerts.createQueryBuilder).not.toHaveBeenCalled();

    const second = setup();
    expect(await second.service.observeJoin({
      ...valid, accountCreatedAtMs: joinedAtMs - 5 * 24 * 3600000,
    })).toBeNull();
    expect(second.alerts.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('exempts trusted users/roles and skips stale or unknown joins', async () => {
    const { service, settings, config, joins } = setup();
    settings.findOne.mockResolvedValue({ ...config, exemptRoleIds: ['345678901234567890'] });
    expect(await service.observeJoin({ ...valid, roleIds: ['345678901234567890'] }))
      .toBeNull();
    expect(joins.createQueryBuilder).not.toHaveBeenCalled();

    const stale = setup();
    expect(await stale.service.observeJoin({
      ...valid, observedAtMs: joinedAtMs + 60000,
    })).toBeNull();
    expect(stale.joins.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('validates complete manager settings and isolates cached guilds', async () => {
    const { service, settings } = setup();
    await expect(service.setConfig(guildId, { enabled: true }))
      .rejects.toThrow('alert_only');
    await expect(service.setConfig(guildId, { ...DEFAULT_ANTI_RAID_CONFIG, enabled: true }))
      .rejects.toThrow('alert channel');
    expect(settings.save).not.toHaveBeenCalled();

    await service.setConfig(guildId, {
      ...DEFAULT_ANTI_RAID_CONFIG, enabled: true,
      alertChannelId: '345678901234567890',
    });
    expect(settings.save).toHaveBeenCalledWith(expect.objectContaining({
      guildId, enabled: true, mode: 'alert_only',
    }));
    await service.getConfig('345678901234567890');
    expect(settings.findOne).toHaveBeenCalledWith({
      where: { guildId: '345678901234567890' },
    });
  });

  it('scopes audit history and conditional finalization to guild', async () => {
    const { service, alerts } = setup();
    await service.recentAlerts(guildId);
    expect(alerts.find).toHaveBeenCalledWith({
      where: { guildId }, order: { createdAt: 'DESC', id: 'DESC' }, take: 20,
    });
    await service.finishAlert(guildId, 11, 'sent');
    expect(alerts.update).toHaveBeenCalledWith(
      { guildId, id: 11, status: 'pending' },
      expect.objectContaining({ status: 'sent', deliveredAt: expect.any(Date) }),
    );
    await service.finishAlert(guildId, 11, 'missing_permissions');
    expect(alerts.update).toHaveBeenCalledWith(
      { guildId, id: 11, status: 'pending' },
      { status: 'failed', failureReason: 'missing_permissions' },
    );
    await expect(service.finishAlert(guildId, 0, 'sent')).rejects.toThrow('alert ID');
  });

  it('prunes expired join metadata opportunistically without a scheduler', async () => {
    const { service, joins, alerts } = setup();
    await service.observeJoin(valid);
    expect(joins.delete).toHaveBeenCalledWith({
      guildId, joinedAt: expect.anything(),
    });
    expect(alerts.delete).toHaveBeenCalledWith({
      guildId, createdAt: expect.anything(),
    });
    await service.observeJoin(valid);
    expect(joins.delete).toHaveBeenCalledTimes(1);
  });
});
