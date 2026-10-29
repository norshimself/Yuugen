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
      goodbyeChannelId: null,
      goodbyeMessage: 'Goodbye {user} from {guild}.',
      welcomeDmEnabled: false,
      welcomeDmMessage: 'Welcome to {guild}, {user}!',
      rulesAcknowledgementEnabled: false,
      rulesChannelId: null,
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

  it('accepts bounded onboarding options without copying unknown entity fields', async () => {
    const { service } = createService();
    const result = await service.updateSettings(guildId, {
      goodbyeChannelId: '345678901234567890',
      goodbyeMessage: 'Farewell {user}!',
      welcomeDmEnabled: true,
      welcomeDmMessage: 'Read the rules in {guild}, {user}.',
      rulesAcknowledgementEnabled: true,
      rulesChannelId: '456789012345678901',
      guildId: otherGuildId,
    });
    expect(result.guildId).toBe(guildId);
    expect(result.goodbyeChannelId).toBe('345678901234567890');
    expect(result.rulesAcknowledgementEnabled).toBe(true);
    expect(result.rulesChannelId).toBe('456789012345678901');
  });

  it('requires a DM and rules channel together before enabling acknowledgement', async () => {
    const { service } = createService();
    await expect(service.updateSettings(guildId, {
      rulesAcknowledgementEnabled: true,
    })).rejects.toThrow('requires welcome DM');
    await expect(service.updateSettings(guildId, {
      welcomeDmEnabled: true,
      rulesAcknowledgementEnabled: true,
    })).rejects.toThrow('rules channel');
    await expect(service.updateSettings(guildId, {
      welcomeDmEnabled: true,
      rulesAcknowledgementEnabled: true,
      rulesChannelId: 'bad',
    })).rejects.toThrow('Invalid rulesChannelId');
  });

  it('rejects malformed templates and nonboolean toggles without saving', async () => {
    const { service, settings } = createService();
    await expect(service.updateSettings(guildId, {
      goodbyeMessage: ''.padEnd(1501, 'x'),
    })).rejects.toThrow('Invalid goodbyeMessage');
    await expect(service.updateSettings(guildId, {
      welcomeDmMessage: '\u0000do not render',
    })).rejects.toThrow('Invalid welcomeDmMessage');
    await expect(service.updateSettings(guildId, {
      welcomeDmEnabled: 'yes' as any,
    })).rejects.toThrow('Invalid welcomeDmEnabled');
    await expect(service.updateSettings(guildId, {
      goodbyeChannelId: 'not-a-snowflake',
    })).rejects.toThrow('Invalid goodbyeChannelId');
    expect(settings.goodbyeChannelId).toBeNull();
  });

  it('uses a fresh read to bypass the thirty-second cache when required', async () => {
    const { service } = createService();
    const repo = (service as any).settingsRepository;
    await service.getSettings(guildId);
    await service.getSettings(guildId);
    expect(repo.findOne).toHaveBeenCalledTimes(1);
    await service.getSettings(guildId, true);
    expect(repo.findOne).toHaveBeenCalledTimes(2);
  });

});
