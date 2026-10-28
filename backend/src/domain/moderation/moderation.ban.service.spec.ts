import { Repository } from 'typeorm';
import { ModerationCase } from './moderation-case.entity';
import { ModerationService } from './moderation.service';

describe('ModerationService permanent ban cases', () => {
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
        raw: [{ id: 90, guildId: guild, action: 'ban' }],
      }),
    };
    const repo = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => ({ id: 90, ...(data as object) })),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as Repository<ModerationCase>;
    return { service: new ModerationService(repo), repo, qb };
  }

  it('writes the pending case before Discord is contacted', async () => {
    const { service, repo } = setup();
    await expect(
      service.beginBan(guild, target, moderator, '  breaking rules  '),
    ).resolves.toEqual(expect.objectContaining({
      id: 90,
      action: 'ban_pending',
      reason: 'breaking rules',
    }));
    expect(repo.create).toHaveBeenCalledWith({
      guildId: guild,
      targetUserId: target,
      moderatorUserId: moderator,
      action: 'ban_pending',
      reason: 'breaking rules',
    });
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed IDs, self bans and bad reasons before writing a case', async () => {
    const { service, repo } = setup();
    await expect(service.beginBan('bad', target, moderator, 'Reason'))
      .rejects.toThrow('Invalid guild ID');
    await expect(service.beginBan(guild, 'bad', moderator, 'Reason'))
      .rejects.toThrow('Invalid target ID');
    await expect(service.beginBan(guild, target, target, 'Reason'))
      .rejects.toThrow('cannot ban yourself');
    await expect(service.beginBan(guild, target, moderator, '  '))
      .rejects.toThrow('Reason');
    await expect(service.beginBan(guild, target, moderator, 'x'.repeat(513)))
      .rejects.toThrow('Reason');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('finalizes a matching guild-owned pending case only once', async () => {
    const { service, qb } = setup();
    expect((await service.finalizeBan(guild, 90, 'ban'))?.action).toBe('ban');
    expect(qb.update).toHaveBeenCalledWith(ModerationCase);
    expect(qb.set).toHaveBeenCalledWith({ action: 'ban' });
    expect(qb.where).toHaveBeenCalledWith('id = :id', { id: 90 });
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId: guild },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"action" = :expected', { expected: 'ban_pending' },
    );
    expect(qb.returning).toHaveBeenCalledWith('*');
  });

  it('preserves a failure status for definitively rejected Discord bans', async () => {
    const { service, qb } = setup();
    await service.finalizeBan(guild, 90, 'ban_failed');
    expect(qb.set).toHaveBeenCalledWith({ action: 'ban_failed' });
  });

  it('never transitions other guild cases or an already completed ban', async () => {
    const { service, qb } = setup();
    qb.execute.mockResolvedValueOnce({ raw: [] });
    expect(await service.finalizeBan(otherGuild, 90, 'ban')).toBeNull();
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId: otherGuild },
    );
  });

  it('rejects case IDs and state names that cannot be finalized', async () => {
    const { service, qb } = setup();
    await expect(service.finalizeBan(guild, 0, 'ban'))
      .rejects.toThrow('Invalid ban case ID');
    await expect(service.finalizeBan(guild, 1.5, 'ban'))
      .rejects.toThrow('Invalid ban case ID');
    await expect(service.finalizeBan(guild, 90, 'kick' as any))
      .rejects.toThrow('Invalid ban case status');
    expect(qb.execute).not.toHaveBeenCalled();
  });

  it('uses the existing guild-scoped moderation case history', async () => {
    const { service, repo } = setup();
    await service.casesForUser(guild, target);
    expect(repo.find).toHaveBeenCalledWith({
      where: { guildId: guild, targetUserId: target },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 10,
    });
  });
});
