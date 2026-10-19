import { Repository } from 'typeorm';
import { GuildSettings } from './guild-settings.entity';
import { SettingsService } from './settings.service';

describe('SettingsService authorization invariants', () => {
  const guildId = '123456789012345678';
  const otherGuildId = '987654321098765432';

  function createService() {
    const settings: GuildSettings = {
      guildId,
      prefix: 'y!',
      welcomeChannelId: '',
      welcomeMessage: 'Welcome!',
      antiSpamEnabled: false,
      profanityFilterEnabled: false,
      blacklistedWords: [],
    };
    const repository = {
      findOne: jest.fn().mockResolvedValue(settings),
      save: jest.fn().mockImplementation(async (entity: GuildSettings) => entity),
    } as unknown as Repository<GuildSettings>;
    return { service: new SettingsService(repository), settings };
  }

  it('never accepts a nested payload that changes the guild primary key', async () => {
    const { service, settings } = createService();
    const result = await service.updateSettings(guildId, {
      guildId: otherGuildId,
      welcomeMessage: 'Hello!',
    });
    expect(result.guildId).toBe(guildId);
    expect(result.welcomeMessage).toBe('Hello!');
    expect(settings.welcomeMessage).toBe('Welcome!');
  });

  it('reflects saved settings immediately without re-querying the database', async () => {
    const { service } = createService();
    const updated = await service.updateSettings(guildId, {
      antiSpamEnabled: true,
      blacklistedWords: ['Spam'],
    });
    const reloaded = await service.getSettings(guildId);
    expect(reloaded).toEqual(updated);
    expect(reloaded.blacklistedWords).toEqual(['spam']);
  });

  it('rejects invalid values without saving them', async () => {
    const { service } = createService();
    await expect(
      service.updateSettings(guildId, { antiSpamEnabled: 'yes' as unknown as boolean }),
    ).rejects.toThrow('Invalid anti-spam setting');
  });
});
