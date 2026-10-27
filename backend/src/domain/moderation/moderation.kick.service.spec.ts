import { Repository } from 'typeorm';
import { ModerationCase } from './moderation-case.entity';
import { ModerationService } from './moderation.service';

describe('ModerationService kick cases', () => {
  const guild = '123456789012345678';
  const otherGuild = '987654321098765432';
  const target = '234567890123456789';
  const moderator = '345678901234567890';

  function setup() {
    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        raw: [{ id: 44, guildId: guild, action: 'kick' }],
      }),
    };
    const repo = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => ({ id: 44, ...data as object })),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as Repository<ModerationCase>;

    return { service: new ModerationService(repo), repo, qb };
  }

  it('persists a pending kick case before the Discord call', async () => {
    const { service, repo } = setup();
    await expect(service.beginKick(guild, target, moderator, ' breaking rules '))
      .resolves.toEqual(expect.objectContaining({
        id: 44, action: 'kick_pending', reason: 'breaking rules',
      }));
    expect(repo.create).toHaveBeenCalledWith({
      guildId: guild,
      targetUserId: target,
      moderatorUserId: moderator,
      action: 'kick_pending',
      reason: 'breaking rules',
    });
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('validates ids and reason length before a case is saved', async () => {
    const { service, repo } = setup();
    await expect(service.beginKick('abc', target, moderator, 'Rule'))
      .rejects.toThrow('Invalid guild ID');
    await expect(service.beginKick(guild, target, target, 'Rule'))
      .rejects.toThrow('cannot kick yourself');
    await expect(service.beginKick(guild, target, moderator, '  '))
      .rejects.toThrow('Reason');
    await expect(service.beginKick(guild, target, moderator, 'x'.repeat(513)))
      .rejects.toThrow('Reason');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('finalizes only a matching guild-owned pending kick', async () => {
    const { service, qb } = setup();
    const result = await service.finalizeKick(guild, 44, 'kick');
    expect(result?.action).toBe('kick');
    expect(qb.where).toHaveBeenCalledWith('id = :id', { id: 44 });
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId: guild },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"action" = :expected', { expected: 'kick_pending' },
    );
    expect(qb.set).toHaveBeenCalledWith({ action: 'kick' });
  });

  it('marks definitive Discord failures without masquerading as successful kicks', async () => {
    const { service, qb } = setup();
    await service.finalizeKick(guild, 44, 'kick_failed');
    expect(qb.set).toHaveBeenCalledWith({ action: 'kick_failed' });
  });

  it('cannot finalize another guild case or a consumed case', async () => {
    const { service, qb } = setup();
    qb.execute.mockResolvedValueOnce({ raw: [] });
    await expect(service.finalizeKick(otherGuild, 44, 'kick'))
      .resolves.toBeNull();
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId: otherGuild },
    );
  });

  it('refuses invalid case ids and states before updating the database', async () => {
    const { service, qb } = setup();
    await expect(service.finalizeKick(guild, 0, 'kick'))
      .rejects.toThrow('Invalid kick case ID');
    await expect(service.finalizeKick(guild, 1, 'ban' as any))
      .rejects.toThrow('Invalid kick case status');
    expect(qb.execute).not.toHaveBeenCalled();
  });

  it('queries recent cases by guild and target only', async () => {
    const { service, repo } = setup();
    await service.casesForUser(guild, target);
    expect(repo.find).toHaveBeenCalledWith({
      where: { guildId: guild, targetUserId: target },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 10,
    });
  });
});
