import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { SettingsService } from '../../domain/settings/settings.service';
import { GuildSettings } from '../../domain/settings/guild-settings.entity';
import { ApiKeyGuard } from '../auth/api-key.guard';

@Controller('settings')
@UseGuards(ApiKeyGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getSettings(@Query('guildId') guildId: string): Promise<GuildSettings> {
    return this.settingsService.getSettings(guildId);
  }

  @Post()
  async updateSettings(
    @Body() body: { guildId: string; settings: Partial<GuildSettings> },
  ): Promise<GuildSettings> {
    return this.settingsService.updateSettings(body.guildId, body.settings);
  }
}
