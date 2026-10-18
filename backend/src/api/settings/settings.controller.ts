import { Controller, Get, Post, Body, Query, UseGuards, Req } from '@nestjs/common';
import { SettingsService } from '../../domain/settings/settings.service';
import { GuildSettings } from '../../domain/settings/guild-settings.entity';
import { ChannelType, Client, PermissionFlagsBits } from 'discord.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GuildAccessGuard, RequireGuildManager } from '../auth/guild-access.guard';

@Controller('settings')
@RequireGuildManager()
@UseGuards(JwtAuthGuard, GuildAccessGuard)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly discordClient: Client,
  ) {}

  @Get('channels')
  async getTextChannels(@Query('guildId') guildId: string, @Req() req: any) {
    const guild = this.discordClient.guilds.cache.get(guildId);
    if (!guild) return { success: false, channels: [] };
    const member = await guild.members
      .fetch({ user: req.user.id, force: true })
      .catch(() => null);
    if (!member) return { success: false, channels: [] };

    const channels = guild.channels.cache
      .filter((channel) => channel.type === ChannelType.GuildText &&
        !!channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel))
      .map((channel) => ({ id: channel.id, name: channel.name }));
    return { success: true, channels };
  }

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
