import { Repository } from 'typeorm';
import { ModerationPurge } from './moderation-purge.entity';
import { ModerationPurgeService } from './moderation-purge.service';

describe('ModerationPurgeService audit integrity', () => {
  const guildId = '123456789012345678';
  const otherGuild = '987654321098765432';
  const channelId = '234567890123456789';
  const actorId = '345678901234567890';
  const messageIds = ['456789012345678901', '456789012345678902'];

  function setup() {
    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        raw: [{ id: 12, guildId, status: 'completed', deletedCount: 2 }],
      }),
    };
    const repo = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => ({
        id: 12, ...data as object,
      })),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as Repository<ModerationPurge>;
    const input = {
      guildId, channelId, moderatorUserId: actorId,
      filterUserId: null, reason: '  spam cleanup  ',
      requestedCount: 4, selectedMessageIds: messageIds,
      scannedCount: 8, skippedOldCount: 1, skippedProtectedCount: 1,
    };
    return { service: new ModerationPurgeService(repo), repo, qb, input };
  }

  it('persists message IDs and counts without storing content', async () => {
    const { service, repo, input } = setup();
    const result = await service.begin(input);
    expect(result).toEqual(expect.objectContaining({
      id: 12, guildId, channelId, moderatorUserId: actorId,
      reason: 'spam cleanup', status: 'pending',
      selectedMessageIds: messageIds,
      selectedCount: 2, deletedCount: 0,
      deletedMessageIds: [], requestedCount: 4,
    }));
    expect(repo.create).toHaveBeenCalledWith(expect.not.objectContaining({
      content: expect.anything(),
      attachments: expect.anything(),
    }));
  });

  it('rejects invalid identities and huge counts before saving anything', async () => {
    const { service, repo, input } = setup();
    await expect(service.begin({ ...input, guildId: 'invalid' }))
      .rejects.toThrow('Invalid guild ID');
    await expect(service.begin({ ...input, channelId: 'invalid' }))
      .rejects.toThrow('Invalid channel ID');
    await expect(service.begin({ ...input, moderatorUserId: 'invalid' }))
      .rejects.toThrow('Invalid moderator ID');
    await expect(service.begin({ ...input, filterUserId: 'bad' }))
      .rejects.toThrow('Invalid filter user ID');
    await expect(service.begin({ ...input, requestedCount: 101 }))
      .rejects.toThrow('Invalid requested count');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects unbounded scan metrics and selected message IDs', async () => {
    const { service, repo, input } = setup();
    await expect(service.begin({ ...input, scannedCount: 501 }))
      .rejects.toThrow('Invalid scanned count');
    await expect(service.begin({
      ...input, skippedOldCount: 9,
    })).rejects.toThrow('Invalid old count');
    await expect(service.begin({
      ...input, selectedMessageIds: [messageIds[0], messageIds[0]],
    })).rejects.toThrow('Invalid selected message IDs');
    await expect(service.begin({
      ...input, selectedMessageIds: ['not-a-snowflake'],
    })).rejects.toThrow('Invalid selected message IDs');
    await expect(service.begin({
      ...input, selectedMessageIds: [],
    })).rejects.toThrow('Invalid selected message IDs');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('requires a nonempty bounded audit reason', async () => {
    const { service, repo, input } = setup();
    await expect(service.begin({ ...input, reason: '   ' }))
      .rejects.toThrow('Reason');
    await expect(service.begin({ ...input, reason: 'x'.repeat(513) }))
      .rejects.toThrow('Reason');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('finalizes only the matching guild pending row', async () => {
    const { service, qb } = setup();
    const result = await service.finish(guildId, 12, 2, messageIds);
    expect(result?.status).toBe('completed');
    expect(qb.update).toHaveBeenCalledWith(ModerationPurge);
    expect(qb.set).toHaveBeenCalledWith(expect.objectContaining({
      deletedCount: 2, deletedMessageIds: messageIds,
      status: 'completed', completedAt: expect.any(Date),
    }));
    expect(qb.where).toHaveBeenCalledWith('id = :id', { id: 12 });
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"status" = :pending', { pending: 'pending' },
    );
  });

  it('records partial and zero-deletion outcomes honestly', async () => {
    const { service, qb } = setup();
    await service.finish(guildId, 12, 2, [messageIds[0]]);
    expect(qb.set).toHaveBeenCalledWith(expect.objectContaining({
      deletedCount: 1, status: 'partial',
    }));
    await service.finish(guildId, 12, 2, []);
    expect(qb.set).toHaveBeenCalledWith(expect.objectContaining({
      deletedCount: 0, status: 'failed',
    }));
  });

  it('does not modify another server purge or a previously completed purge', async () => {
    const { service, qb } = setup();
    qb.execute.mockResolvedValueOnce({ raw: [] });
    expect(await service.finish(otherGuild, 12, 2, messageIds)).toBeNull();
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId: otherGuild },
    );
  });

  it('rejects invalid audit IDs, duplicate or unbounded deleted IDs', async () => {
    const { service, qb } = setup();
    await expect(service.finish(guildId, -1, 2, messageIds))
      .rejects.toThrow('Invalid purge ID');
    await expect(service.finish(guildId, 12, 0, messageIds))
      .rejects.toThrow('Invalid selected count');
    await expect(service.finish(guildId, 12, 2,
      [messageIds[0], messageIds[0]]))
      .rejects.toThrow('Invalid deleted IDs');
    await expect(service.finish(guildId, 12, 1, messageIds))
      .rejects.toThrow('Invalid deleted IDs');
    await expect(service.finish(guildId, 12, 2, ['bad']))
      .rejects.toThrow('Invalid deleted IDs');
    expect(qb.execute).not.toHaveBeenCalled();
  });
});
