import {
  BadRequestException, Body, Controller, Get, Post, Query, UseGuards,
} from '@nestjs/common';
import { ChannelType, Client, PermissionFlagsBits } from 'discord.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GuildAccessGuard, RequireGuildManager } from '../auth/guild-access.guard';
import { AntiRaidService } from '../../domain/security/anti-raid.service';
import { validateAntiRaidConfig, type AntiRaidConfig } from '../../domain/security/anti-raid-policy';

/** Access to all endpoints requires a live, verified guild manager session. */
@Controller('anti-raid')
@RequireGuildManager()
@UseGuards(JwtAuthGuard, GuildAccessGuard)
export class AntiRaidController {
  constructor(
    private readonly antiRaid: AntiRaidService,
    private readonly discordClient: Client,
  ) {}

  @Get()
  get(@Query('guildId') guildId: string) {
    return this.antiRaid.getConfig(guildId);
  }

  @Get('alerts')
  alerts(@Query('guildId') guildId: string) {
    return this.antiRaid.recentAlerts(guildId);
  }

  @Post()
  async configure(@Body() body: { guildId: string; settings: AntiRaidConfig }) {
    const problem = validateAntiRaidConfig(body?.settings);
    if (problem) throw new BadRequestException(problem);
    const settings = body.settings;
    if (settings.alertChannelId) {
      const guild = this.discordClient.guilds.cache.get(body.guildId);
      const channel = await guild?.channels.fetch(settings.alertChannelId)
        .catch(() => null);
      const bot = guild?.members.me ||
        await guild?.members.fetchMe().catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText || !bot ||
          !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel) ||
          !channel.permissionsFor(bot)?.has(PermissionFlagsBits.SendMessages)) {
        throw new BadRequestException('Select a writable guild text channel for anti-raid alerts');
      }
    }
    return this.antiRaid.setConfig(body.guildId, settings);
  }
}
