import { Repository } from 'typeorm';
import { ModerationCase } from './moderation-case.entity';
import { ModerationService } from './moderation.service';

describe('ModerationService timeout audit cases', () => {
  const guild = '123456789012345678';
  const otherGuild = '987654321098765432';
  const target = '234567890123456789';
  const moderator = '345678901234567890';
  const MINUTE = 60_000;
  const MAX = 28 * 24 * 60 * 60 * 1000;

  function setup() {
    const query = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        raw: [{ id: 53, guildId: guild, action: 'timeout' }],
      }),
    };
    const repo = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => ({ id: 53, ...(data as object) })),
      createQueryBuilder: jest.fn().mockReturnValue(query),
    } as unknown as Repository<ModerationCase>;
    return { service: new ModerationService(repo), repo, query };
  }

  it('persists a requested timeout expiry before contacting Discord', async () => {
    const { service, repo } = setup();
    const before = Date.now();
    const result = await service.beginTimedAction(
      guild, target, moderator, '  spam  ', 'timeout', 600_000,
    );
    const after = Date.now();
    expect(result).toEqual(expect.objectContaining({
      id: 53,
      action: 'timeout_pending',
      reason: 'spam',
    }));
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 600_000);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 600_000);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('creates an independent untimeout_pending case without an expiry', async () => {
    const { service, repo } = setup();
    await service.beginTimedAction(guild, target, moderator, 'Appeal', 'untimeout');
    expect(repo.create).toHaveBeenCalledWith({
      guildId: guild,
      targetUserId: target,
      moderatorUserId: moderator,
      action: 'untimeout_pending',
      reason: 'Appeal',
      expiresAt: null,
    });
  });

  it('requires 1 minute to 28 days and integer milliseconds', async () => {
    const { service, repo } = setup();
    for (const duration of [0, 59_999, MAX + 1, Infinity, NaN, 1.5, -1]) {
      await expect(service.beginTimedAction(
        guild, target, moderator, 'Reason', 'timeout', duration,
      )).rejects.toThrow('1 minute to 28 days');
    }
    await expect(service.beginTimedAction(
      guild, target, moderator, 'Reason', 'timeout',
    )).rejects.toThrow('1 minute to 28 days');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('allows the maximum exactly, but prohibits duration on removal', async () => {
    const { service, repo } = setup();
    await service.beginTimedAction(guild, target, moderator, 'Reason', 'timeout', MAX);
    await expect(service.beginTimedAction(
      guild, target, moderator, 'Reason', 'untimeout', MINUTE,
    )).rejects.toThrow('must not specify a duration');
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('rejects self moderation, invalid IDs and invalid reasons', async () => {
    const { service, repo } = setup();
    await expect(service.beginTimedAction(
      'invalid', target, moderator, 'Reason', 'timeout', MINUTE,
    )).rejects.toThrow('Invalid guild ID');
    await expect(service.beginTimedAction(
      guild, 'bad', moderator, 'Reason', 'timeout', MINUTE,
    )).rejects.toThrow('Invalid target ID');
    await expect(service.beginTimedAction(
      guild, target, 'bad', 'Reason', 'timeout', MINUTE,
    )).rejects.toThrow('Invalid moderator ID');
    await expect(service.beginTimedAction(
      guild, moderator, moderator, 'Reason', 'timeout', MINUTE,
    )).rejects.toThrow('cannot moderate yourself');
    await expect(service.beginTimedAction(
      guild, target, moderator, ' ', 'timeout', MINUTE,
    )).rejects.toThrow('Reason');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('atomically finalizes a timeout owned by this guild', async () => {
    const { service, query } = setup();
    expect((await service.finalizeTimedAction(guild, 53, 'timeout', 'success'))?.action)
      .toBe('timeout');
    expect(query.update).toHaveBeenCalledWith(ModerationCase);
    expect(query.set).toHaveBeenCalledWith({ action: 'timeout' });
    expect(query.where).toHaveBeenCalledWith('id = :id', { id: 53 });
    expect(query.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId: guild },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      '"action" = :expected', { expected: 'timeout_pending' },
    );
  });

  it('finalizes untimeout and both failure states independently', async () => {
    const { service, query } = setup();
    await service.finalizeTimedAction(guild, 53, 'untimeout', 'success');
    expect(query.set).toHaveBeenCalledWith({ action: 'untimeout' });
    await service.finalizeTimedAction(guild, 53, 'timeout', 'failed');
    expect(query.set).toHaveBeenCalledWith({ action: 'timeout_failed' });
    await service.finalizeTimedAction(guild, 53, 'untimeout', 'failed');
    expect(query.set).toHaveBeenCalledWith({ action: 'untimeout_failed' });
  });

  it('cannot finalize an already-completed case or a case in another guild', async () => {
    const { service, query } = setup();
    query.execute.mockResolvedValueOnce({ raw: [] });
    const result = await service.finalizeTimedAction(
      otherGuild, 53, 'timeout', 'success',
    );
    expect(result).toBeNull();
    expect(query.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId: otherGuild },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      '"action" = :expected', { expected: 'timeout_pending' },
    );
  });

  it('rejects invalid case IDs, action and outcome before calling SQL', async () => {
    const { service, query } = setup();
    await expect(service.finalizeTimedAction(
      guild, -1, 'timeout', 'success',
    )).rejects.toThrow('Invalid moderation case ID');
    await expect(service.finalizeTimedAction(
      guild, 1.5, 'timeout', 'success',
    )).rejects.toThrow('Invalid moderation case ID');
    await expect(service.finalizeTimedAction(
      guild, 53, 'ban' as any, 'success',
    )).rejects.toThrow('Invalid timeout action');
    await expect(service.finalizeTimedAction(
      guild, 53, 'timeout', 'unknown' as any,
    )).rejects.toThrow('Invalid timeout outcome');
    expect(query.execute).not.toHaveBeenCalled();
  });
});
