import { Repository } from 'typeorm';
import { ModerationCase } from './moderation-case.entity';
import { ModerationService } from './moderation.service';

describe('ModerationService unban case lifecycle', () => {
  const guildId = '123456789012345678';
  const otherGuild = '987654321098765432';
  const targetId = '234567890123456789';
  const actorId = '345678901234567890';

  function setup() {
    const query = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        raw: [{ id: 51, guildId, action: 'unban' }],
      }),
    };
    const repo = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => ({ id: 51, ...(data as object) })),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(query),
    } as unknown as Repository<ModerationCase>;
    return { service: new ModerationService(repo), repo, query };
  }

  it('stores unban_pending with normalized reason before the Discord API call', async () => {
    const { service, repo } = setup();
    await expect(
      service.beginUnban(guildId, targetId, actorId, '  issued in error  '),
    ).resolves.toEqual(expect.objectContaining({
      id: 51,
      action: 'unban_pending',
      reason: 'issued in error',
    }));
    expect(repo.create).toHaveBeenCalledWith({
      guildId,
      targetUserId: targetId,
      moderatorUserId: actorId,
      action: 'unban_pending',
      reason: 'issued in error',
    });
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('validates guild, user and moderator IDs and rejects self-unbans', async () => {
    const { service, repo } = setup();
    await expect(service.beginUnban('invalid', targetId, actorId, 'Reason'))
      .rejects.toThrow('Invalid guild ID');
    await expect(service.beginUnban(guildId, 'bad', actorId, 'Reason'))
      .rejects.toThrow('Invalid target ID');
    await expect(service.beginUnban(guildId, targetId, 'bad', 'Reason'))
      .rejects.toThrow('Invalid moderator ID');
    await expect(service.beginUnban(guildId, actorId, actorId, 'Reason'))
      .rejects.toThrow('cannot unban yourself');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects empty and oversized reasons before persisting', async () => {
    const { service, repo } = setup();
    await expect(service.beginUnban(guildId, targetId, actorId, ' '))
      .rejects.toThrow('Reason');
    await expect(service.beginUnban(guildId, targetId, actorId, 'z'.repeat(513)))
      .rejects.toThrow('Reason');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('finalizes only a matching guild-owned pending case', async () => {
    const { service, query } = setup();
    await expect(service.finalizeUnban(guildId, 51, 'unban'))
      .resolves.toEqual(expect.objectContaining({ action: 'unban' }));
    expect(query.update).toHaveBeenCalledWith(ModerationCase);
    expect(query.set).toHaveBeenCalledWith({ action: 'unban' });
    expect(query.where).toHaveBeenCalledWith('id = :id', { id: 51 });
    expect(query.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      '"action" = :expected', { expected: 'unban_pending' },
    );
    expect(query.returning).toHaveBeenCalledWith('*');
  });

  it('records a definitive Discord rejection as unban_failed', async () => {
    const { service, query } = setup();
    await service.finalizeUnban(guildId, 51, 'unban_failed');
    expect(query.set).toHaveBeenCalledWith({ action: 'unban_failed' });
  });

  it('cannot touch another guild case or finalize an already terminal case', async () => {
    const { service, query } = setup();
    query.execute.mockResolvedValueOnce({ raw: [] });
    const result = await service.finalizeUnban(otherGuild, 51, 'unban');
    expect(result).toBeNull();
    expect(query.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId: otherGuild },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      '"action" = :expected', { expected: 'unban_pending' },
    );
  });

  it('fails before SQL for invalid case IDs and state transitions', async () => {
    const { service, query } = setup();
    await expect(service.finalizeUnban(guildId, 0, 'unban'))
      .rejects.toThrow('Invalid unban case ID');
    await expect(service.finalizeUnban(guildId, 1.5, 'unban'))
      .rejects.toThrow('Invalid unban case ID');
    await expect(service.finalizeUnban(guildId, 51, 'ban' as any))
      .rejects.toThrow('Invalid unban case status');
    expect(query.execute).not.toHaveBeenCalled();
  });

  it('retains the previous ban case: an unban creates a new case rather than deleting history', async () => {
    const { service, repo } = setup();
    await service.beginUnban(guildId, targetId, actorId, 'Appeal approved');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'unban_pending',
    }));
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
