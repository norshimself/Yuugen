import { Repository } from 'typeorm';
import { ModerationVoiceCase } from './moderation-voice-case.entity';
import { ModerationVoiceCaseService } from './moderation-voice-case.service';

describe('ModerationVoiceCaseService', () => {
  const guildId = '123456789012345678';
  const anotherGuild = '987654321098765432';
  const actor = '234567890123456789';
  const target = '345678901234567890';
  const source = '456789012345678901';
  const destination = '567890123456789012';

  function setup() {
    const qb = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        raw: [{ id: 72, guildId, action: 'mute', status: 'pending' }],
      }),
    };
    const repo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<ModerationVoiceCase>;
    const input = {
      guildId, moderatorUserId: actor, targetUserId: target,
      action: 'mute' as const, sourceChannelId: source,
      destinationChannelId: null, reason: '  continued disruption  ',
    };
    return {
      service: new ModerationVoiceCaseService(repo),
      repo, qb, input,
    };
  }

  it('writes a pending mute audit with source, target and actor before Discord', async () => {
    const { service, qb, input } = setup();
    await expect(service.begin(input)).resolves.toEqual(expect.objectContaining({
      id: 72, status: 'pending',
    }));
    expect(qb.insert).toHaveBeenCalled();
    expect(qb.into).toHaveBeenCalledWith(ModerationVoiceCase);
    expect(qb.values).toHaveBeenCalledWith(expect.objectContaining({
      guildId,
      moderatorUserId: actor,
      targetUserId: target,
      sourceChannelId: source,
      destinationChannelId: null,
      action: 'mute',
      reason: 'continued disruption',
      status: 'pending',
    }));
    expect(qb.orIgnore).toHaveBeenCalled();
    expect(qb.returning).toHaveBeenCalledWith('*');
  });

  it('saves a move with an explicit distinct source and destination', async () => {
    const { service, qb, input } = setup();
    await service.begin({
      ...input, action: 'move', destinationChannelId: destination,
    });
    expect(qb.values).toHaveBeenCalledWith(expect.objectContaining({
      action: 'move',
      sourceChannelId: source,
      destinationChannelId: destination,
    }));
  });

  it('blocks a second pending voice operation against the same target', async () => {
    const { service, qb, input } = setup();
    qb.execute.mockResolvedValueOnce({ raw: [] });
    expect(await service.begin(input)).toBeNull();
    expect(qb.orIgnore).toHaveBeenCalled();
  });

  it('validates all Discord snowflakes and prohibits self moderation', async () => {
    const { service, qb, input } = setup();
    await expect(service.begin({ ...input, guildId: 'nope' }))
      .rejects.toThrow('Invalid guild ID');
    await expect(service.begin({ ...input, moderatorUserId: 'nope' }))
      .rejects.toThrow('Invalid moderator ID');
    await expect(service.begin({ ...input, targetUserId: 'nope' }))
      .rejects.toThrow('Invalid target ID');
    await expect(service.begin({ ...input, sourceChannelId: 'nope' }))
      .rejects.toThrow('Invalid source channel ID');
    await expect(service.begin({
      ...input, action: 'move', destinationChannelId: 'nope',
    })).rejects.toThrow('Invalid destination channel ID');
    await expect(service.begin({ ...input, targetUserId: actor }))
      .rejects.toThrow('yourself');
    expect(qb.execute).not.toHaveBeenCalled();
  });

  it('rejects missing, unchanged and unsupported destinations', async () => {
    const { service, qb, input } = setup();
    await expect(service.begin({
      ...input, action: 'move', destinationChannelId: null,
    })).rejects.toThrow('different destination');
    await expect(service.begin({
      ...input, action: 'move', destinationChannelId: source,
    })).rejects.toThrow('different destination');
    await expect(service.begin({
      ...input, destinationChannelId: destination,
    })).rejects.toThrow('Only move');
    await expect(service.begin({
      ...input, action: 'invalid' as any,
    })).rejects.toThrow('Invalid voice action');
    expect(qb.execute).not.toHaveBeenCalled();
  });

  it('refuses empty, too-long or malformed reasons', async () => {
    const { service, qb, input } = setup();
    await expect(service.begin({ ...input, reason: ' ' }))
      .rejects.toThrow('Reason');
    await expect(service.begin({ ...input, reason: 'x'.repeat(513) }))
      .rejects.toThrow('Reason');
    expect(qb.execute).not.toHaveBeenCalled();
  });

  it('conditionally finalizes only a guild-and-action-matched pending case', async () => {
    const { service, qb } = setup();
    await service.finish(guildId, 72, 'mute', 'completed');
    expect(qb.update).toHaveBeenCalledWith(ModerationVoiceCase);
    expect(qb.where).toHaveBeenCalledWith('id = :id', { id: 72 });
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"action" = :action', { action: 'mute' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"status" = :status', { status: 'pending' },
    );
    expect(qb.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed', lastError: null, finishedAt: expect.any(Date),
    }));
  });

  it('records a definite rejection with a terminal failure status', async () => {
    const { service, qb } = setup();
    await service.finish(guildId, 72, 'deafen', 'failed');
    expect(qb.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      lastError: 'Discord rejected the operation',
    }));
  });

  it('cannot finalize a different guild or an already final case', async () => {
    const { service, qb } = setup();
    qb.execute.mockResolvedValueOnce({ raw: [] });
    expect(await service.finish(anotherGuild, 72, 'mute', 'completed'))
      .toBeNull();
    expect(qb.andWhere).toHaveBeenCalledWith(
      '"guildId" = :guildId', { guildId: anotherGuild },
    );
  });

  it('rejects invalid case ID, action and status before SQL', async () => {
    const { service, qb } = setup();
    await expect(service.finish(guildId, -1, 'mute', 'completed'))
      .rejects.toThrow('Invalid voice case ID');
    await expect(service.finish(guildId, 1.5, 'mute', 'completed'))
      .rejects.toThrow('Invalid voice case ID');
    await expect(service.finish(guildId, 72, 'kick' as any, 'completed'))
      .rejects.toThrow('Invalid voice action');
    await expect(service.finish(guildId, 72, 'mute', 'pending' as any))
      .rejects.toThrow('Invalid voice outcome');
    expect(qb.execute).not.toHaveBeenCalled();
  });

  it('limits history queries to target, guild and recent cases', async () => {
    const { service, repo } = setup();
    await service.recent(guildId, target);
    expect(repo.find).toHaveBeenCalledWith({
      where: { guildId, targetUserId: target },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 10,
    });
  });
});
