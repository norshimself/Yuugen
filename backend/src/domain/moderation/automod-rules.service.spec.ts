import { Repository } from 'typeorm';
import { AutoModRule } from './automod-rule.entity';
import { AutoModRulesService } from './automod-rules.service';

describe('AutoModRulesService', () => {
  const guild = '123456789012345678';
  const other = '234567890123456789';
  const input = {
    name: 'Safety rule', enabled: false, kind: 'blocked_phrases' as const,
    action: 'dry_run' as const, priority: 10, phrases: ['spam'],
    threshold: 6, windowSeconds: 8,
    exemptChannelIds: [] as string[], exemptRoleIds: [] as string[],
  };
  function setup() {
    const repo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => ({ id: 9, ...v as object })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Repository<AutoModRule>;
    return { repo, service: new AutoModRulesService(repo) };
  }
  it('scopes reads to the exact guild and sorts by priority', async () => {
    const { repo, service } = setup();
    await service.list(guild);
    expect(repo.find).toHaveBeenCalledWith({
      where: { guildId: guild },
      order: { priority: 'ASC', id: 'ASC' }, take: 50,
    });
  });
  it('does not leak cached rules across guilds', async () => {
    const { repo, service } = setup();
    await service.list(guild);
    await service.list(guild);
    await service.list(other);
    expect(repo.find).toHaveBeenCalledTimes(2);
  });
  it('creates a rule disabled by default only if explicitly supplied', async () => {
    const { repo, service } = setup();
    await service.create(guild, input);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      guildId: guild, enabled: false, action: 'dry_run',
    }));
  });
  it('rejects malformed and oversized rules before a database write', async () => {
    const { repo, service } = setup();
    await expect(service.create('invalid', input)).rejects.toThrow('guild');
    await expect(service.create(guild, { ...input, name: '' }))
      .rejects.toThrow('name');
    await expect(service.create(guild, { ...input, threshold: 30 }))
      .rejects.toThrow('threshold');
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('limits rules per guild', async () => {
    const { repo, service } = setup();
    (repo.count as jest.Mock).mockResolvedValue(50);
    await expect(service.create(guild, input)).rejects.toThrow('50');
  });
  it('enables only an existing guild-owned rule', async () => {
    const { repo, service } = setup();
    await service.setEnabled(guild, 9, true);
    expect(repo.update).toHaveBeenCalledWith({ guildId: guild, id: 9 }, { enabled: true });
    await expect(service.setEnabled(guild, 0, true)).rejects.toThrow('Invalid');
    await expect(service.setEnabled(other, 9, 'yes' as any)).rejects.toThrow('Invalid');
  });
  it('invalidates cached rules after updates', async () => {
    const { repo, service } = setup();
    await service.list(guild);
    await service.setEnabled(guild, 9, true);
    await service.list(guild);
    expect(repo.find).toHaveBeenCalledTimes(2);
  });
});
