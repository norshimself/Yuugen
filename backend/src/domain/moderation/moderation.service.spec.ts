import { Repository } from 'typeorm';
import { ModerationCase } from './moderation-case.entity';
import { ModerationService } from './moderation.service';

describe('ModerationService warning cases', () => {
  const guildId = '123456789012345678';
  const otherGuildId = '987654321098765432';
  const targetId = '234567890123456789';
  const moderatorId = '345678901234567890';

  function setup() {
    const builder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        raw: [{ id: 7, guildId, targetUserId: targetId, action: 'warn' }],
      }),
    };
    const repository = {
      create: jest.fn((input: any) => input),
      save: jest.fn(async (input: any) => ({
        id: 7,
        createdAt: new Date(),
        ...input,
      })),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    } as unknown as Repository<ModerationCase>;

    return {
      service: new ModerationService(repository),
      repo: repository,
      builder,
    };
  }

  it('creates a guild-scoped warning with a normalized reason', async () => {
    const { service, repo } = setup();
    const result = await service.warn(guildId, targetId, moderatorId, '  rule 1  ');
    expect(result.id).toBe(7);
    expect(repo.create).toHaveBeenCalledWith({
      guildId,
      targetUserId: targetId,
      moderatorUserId: moderatorId,
      action: 'warn',
      reason: 'rule 1',
    });
  });

  it('does not accept invalid ids or empty/oversized reasons', async () => {
    const { service, repo } = setup();
    await expect(service.warn('bad', targetId, moderatorId, 'Rule'))
      .rejects.toThrow('Invalid guild ID');
    await expect(service.warn(guildId, targetId, targetId, 'Rule'))
      .rejects.toThrow('cannot warn yourself');
    await expect(service.warn(guildId, targetId, moderatorId, '   '))
      .rejects.toThrow('Reason');
    await expect(service.warn(guildId, targetId, moderatorId, 'x'.repeat(513)))
      .rejects.toThrow('Reason');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('queries warning history only within one guild and newest first', async () => {
    const { service, repo } = setup();
    await service.warnings(guildId, targetId);
    expect(repo.find).toHaveBeenCalledWith({
      where: { guildId, targetUserId: targetId, action: 'warn' },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 10,
    });
  });

  it('atomically revokes an active warning within its originating guild', async () => {
    const { service, builder } = setup();
    const result = await service.unwarn(guildId, 7, moderatorId, 'mistake');
    expect(result?.id).toBe(7);
    expect(builder.update).toHaveBeenCalledWith(ModerationCase);
    expect(builder.set).toHaveBeenCalledWith(expect.objectContaining({
      revokedAt: expect.any(Date),
      revokedByUserId: moderatorId,
      revocationReason: 'mistake',
    }));
    expect(builder.where).toHaveBeenCalledWith('id = :id', { id: 7 });
    expect(builder.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId },
    );
    expect(builder.andWhere).toHaveBeenCalledWith('"revokedAt" IS NULL');
    expect(builder.returning).toHaveBeenCalledWith('*');
  });

  it('does not reveal whether another guild has the requested case ID', async () => {
    const { service, builder } = setup();
    builder.execute.mockResolvedValueOnce({ raw: [] });
    const result = await service.unwarn(otherGuildId, 7, moderatorId);
    expect(result).toBeNull();
    expect(builder.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId: otherGuildId },
    );
  });

  it('rejects invalid case IDs without running an update', async () => {
    const { service, builder } = setup();
    await expect(service.unwarn(guildId, -1, moderatorId))
      .rejects.toThrow('Invalid warning case ID');
    await expect(service.unwarn(guildId, 1.5, moderatorId))
      .rejects.toThrow('Invalid warning case ID');
    expect(builder.execute).not.toHaveBeenCalled();
  });
});
