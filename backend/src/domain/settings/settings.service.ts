import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GuildSettings } from './guild-settings.entity';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(GuildSettings)
    private settingsRepository: Repository<GuildSettings>,
  ) {}

  async getSettings(guildId: string): Promise<GuildSettings> {
    let settings = await this.settingsRepository.findOne({
      where: { guildId },
    });
    if (!settings) {
      settings = this.settingsRepository.create({ guildId });
      await this.settingsRepository.save(settings);
    }
    return settings;
  }

  async updateSettings(
    guildId: string,
    updateData: Partial<GuildSettings>,
  ): Promise<GuildSettings> {
    const settings = await this.getSettings(guildId);
    Object.assign(settings, updateData);
    return this.settingsRepository.save(settings);
  }
}
