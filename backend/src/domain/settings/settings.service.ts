import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GuildSettings } from './guild-settings.entity';

@Injectable()
export class SettingsService {
  private readonly cache = new Map<
    string,
    { settings: GuildSettings; expiresAt: number }
  >();
  constructor(
    @InjectRepository(GuildSettings)
    private settingsRepository: Repository<GuildSettings>,
  ) {}

  async getSettings(guildId: string): Promise<GuildSettings> {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.settings;
    }
    let settings = await this.settingsRepository.findOne({
      where: { guildId },
    });
    if (!settings) {
      settings = this.settingsRepository.create({ guildId });
      await this.settingsRepository.save(settings);
    }
    this.cache.set(guildId, { settings, expiresAt: Date.now() + 30_000 });
    return settings;
  }

  async updateSettings(
    guildId: string,
    updateData: Partial<GuildSettings>,
  ): Promise<GuildSettings> {
    const current = await this.getSettings(guildId);
    // Validate and save a copy so invalid payloads cannot mutate the cache.
    const settings = { ...current } as GuildSettings;

    // Explicit allowlist: never copy guildId (a primary key) or arbitrary
    // client-supplied properties into a persisted settings entity.
    if (updateData.prefix !== undefined) {
      if (typeof updateData.prefix !== 'string' ||
          updateData.prefix.length < 1 || updateData.prefix.length > 5) {
        throw new BadRequestException('Invalid command prefix');
      }
      settings.prefix = updateData.prefix;
    }
    if (updateData.welcomeChannelId !== undefined) {
      const value: unknown = updateData.welcomeChannelId;
      if (value !== null &&
          (typeof value !== 'string' || value.length > 20)) {
        throw new BadRequestException('Invalid welcome channel ID');
      }
      settings.welcomeChannelId = typeof value === 'string' ? value : '';
    }
    if (updateData.welcomeMessage !== undefined) {
      if (typeof updateData.welcomeMessage !== 'string' ||
          updateData.welcomeMessage.length < 1 ||
          updateData.welcomeMessage.length > 2000) {
        throw new BadRequestException('Invalid welcome message');
      }
      settings.welcomeMessage = updateData.welcomeMessage;
    }
    if (updateData.antiSpamEnabled !== undefined) {
      if (typeof updateData.antiSpamEnabled !== 'boolean') {
        throw new BadRequestException('Invalid anti-spam setting');
      }
      settings.antiSpamEnabled = updateData.antiSpamEnabled;
    }
    if (updateData.profanityFilterEnabled !== undefined) {
      if (typeof updateData.profanityFilterEnabled !== 'boolean') {
        throw new BadRequestException('Invalid profanity setting');
      }
      settings.profanityFilterEnabled = updateData.profanityFilterEnabled;
    }
    if (updateData.blacklistedWords !== undefined) {
      const words: unknown = updateData.blacklistedWords;
      if (!Array.isArray(words) || words.length > 100 ||
          !words.every((word) => typeof word === 'string' &&
            word.trim().length >= 1 && word.length <= 100 && !word.includes(','))) {
        throw new BadRequestException('Invalid word blacklist');
      }
      settings.blacklistedWords = [...new Set(words.map((word: string) =>
        word.trim().toLowerCase()))];
    }
    const saved = await this.settingsRepository.save(settings);
    this.cache.set(guildId, { settings: saved, expiresAt: Date.now() + 30_000 });
    return saved;
  }
}
