import { Repository } from 'typeorm';
import { ModerationChannelLock } from './moderation-channel-lock.entity';
import { ModerationChannelLockService } from './moderation-channel-lock.service';

describe('ModerationChannelLockService', () => {
  const guild = '123456789012345678';
  const channel = '234567890123456789';
  const actor = '345678901234567890';
  const otherGuild = '987654321098765432';
  const snapshot = {
    originalExisted: true,
    originalAllow: '8',
    originalDeny: '16',
    lockedAllow: '8',
    lockedDeny: '2064',
  };

  function setup() {
    const qb = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        raw: [{ id: 17, guildId: guild, channelId: channel,
          status: 'lock_pending', ...snapshot }],
      }),
    };
    const repo = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as Repository<ModerationChannelLock>;
    return { service: new ModerationChannelLockService(repo), repo, qb };
  }

  it('reads only active channel locks scoped to the actual guild', async () => {
    const { service, repo } = setup();
    await service.getActive(guild, channel);
    expect(repo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        guildId: guild, channelId: channel, status: expect.anything(),
      }),
      order: { createdAt: 'DESC', id: 'DESC' },
    }));
  });

  it('inserts an immutable snapshot with a unique-index conflict guard', async () => {
    const { service, qb } = setup();
    await expect(service.beginLock(
      guild, channel, actor, '  safety review  ', snapshot,
    )).resolves.toEqual(expect.objectContaining({ id: 17 }));
    expect(qb.insert).toHaveBeenCalled();
    expect(qb.into).toHaveBeenCalledWith(ModerationChannelLock);
    expect(qb.orIgnore).toHaveBeenCalled();
    expect(qb.values).toHaveBeenCalledWith(expect.objectContaining({
      guildId: guild, channelId: channel,
      lockedByUserId: actor, lockReason: 'safety review',
      originalAllow: '8', lockedDeny: '2064', status: 'lock_pending',
    }));
  });

  it('returns null on competing lock inserts without modifying anything', async () => {
    const { service, qb } = setup();
    qb.execute.mockResolvedValueOnce({ raw: [] });
    const record = await service.beginLock(
      guild, channel, actor, 'Reason', snapshot,
    );
    expect(record).toBeNull();
    expect(qb.orIgnore).toHaveBeenCalled();
  });

  it('rejects invalid identities, reason, and snapshot before writing', async () => {
    const { service, qb } = setup();
    await expect(service.beginLock('bad', channel, actor, 'Rule', snapshot))
      .rejects.toThrow('guild ID');
    await expect(service.beginLock(guild, 'bad', actor, 'Rule', snapshot))
      .rejects.toThrow('channel ID');
    await expect(service.beginLock(guild, channel, 'bad', 'Rule', snapshot))
      .rejects.toThrow('moderator ID');
    await expect(service.beginLock(guild, channel, actor, '', snapshot))
      .rejects.toThrow('Reason');
    await expect(service.beginLock(guild, channel, actor, 'Rule', {
      ...snapshot, originalAllow: 'not-a-decimal',
    })).rejects.toThrow('snapshot');
    expect(qb.execute).not.toHaveBeenCalled();
  });

  it('only finalizes a guild-owned pending lock, never a completed lock', async () => {
    const { service, qb } = setup();
    await service.finishLock(guild, 17, 'locked');
    expect(qb.update).toHaveBeenCalledWith(ModerationChannelLock);
    expect(qb.where).toHaveBeenCalledWith('id = :id', { id: 17 });
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId: guild },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"status" = :pending', { pending: 'lock_pending' },
    );
    expect(qb.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'locked', lockedAt: expect.any(Date),
    }));
  });

  it('marks definitive Discord lock rejection without leaving an active lock', async () => {
    const { service, qb } = setup();
    await service.finishLock(guild, 17, 'failed');
    expect(qb.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', lastError: 'Discord rejected lock',
    }));
  });

  it('begins unlock only from a locked record for the same guild', async () => {
    const { service, qb } = setup();
    await service.beginUnlock(guild, 17, actor, '  Open again ');
    expect(qb.set).toHaveBeenCalledWith({
      status: 'unlock_pending',
      unlockedByUserId: actor,
      unlockReason: 'Open again',
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"status" = :locked', { locked: 'locked' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId: guild },
    );
  });

  it('returns null if another bot worker already consumed the unlock', async () => {
    const { service, qb } = setup();
    qb.execute.mockResolvedValueOnce({ raw: [] });
    expect(await service.beginUnlock(guild, 17, actor, 'Reason')).toBeNull();
  });

  it('records success or returns to locked on definitive unlock rejection', async () => {
    const { service, qb } = setup();
    await service.finishUnlock(guild, 17, 'unlocked');
    expect(qb.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'unlocked', unlockedAt: expect.any(Date),
    }));
    await service.finishUnlock(guild, 17, 'locked');
    expect(qb.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'locked', lastError: 'Discord rejected unlock',
    }));
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"status" = :pending', { pending: 'unlock_pending' },
    );
  });

  it('protects other guild cases and rejects invalid IDs/states', async () => {
    const { service, qb } = setup();
    qb.execute.mockResolvedValueOnce({ raw: [] });
    expect(await service.finishUnlock(otherGuild, 17, 'unlocked')).toBeNull();
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId: otherGuild },
    );
    await expect(service.beginUnlock(guild, 0, actor, 'Reason'))
      .rejects.toThrow('lock ID');
    await expect(service.finishLock(guild, 17, 'other' as any))
      .rejects.toThrow('outcome');
    await expect(service.finishUnlock(guild, 17, 'other' as any))
      .rejects.toThrow('outcome');
  });
});
