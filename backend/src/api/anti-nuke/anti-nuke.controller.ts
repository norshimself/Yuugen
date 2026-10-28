import {
  BadRequestException, Body, Controller, Get, Param, ParseIntPipe,
  Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ChannelType, Client, PermissionFlagsBits } from 'discord.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GuildAccessGuard, RequireGuildManager } from '../auth/guild-access.guard';
import { AntiNukeService } from '../../domain/security/anti-nuke.service';
import {
  validateAntiNukeConfig, type AntiNukeConfig,
} from '../../domain/security/anti-nuke-policy';

/** All read/write operations require a current JWT and Manage Server. */
@Controller('anti-nuke')
@RequireGuildManager()
@UseGuards(JwtAuthGuard, GuildAccessGuard)
export class AntiNukeController {
  constructor(
    private readonly antiNuke: AntiNukeService,
    private readonly discordClient: Client,
  ) {}

  @Get()
  config(@Query('guildId') guildId: string) {
    return this.antiNuke.getConfig(guildId);
  }

  @Get('alerts')
  alerts(@Query('guildId') guildId: string) {
    return this.antiNuke.recentAlerts(guildId);
  }

  @Post()
  async configure(@Body() body: { guildId: string; settings: AntiNukeConfig }) {
    const error = validateAntiNukeConfig(body?.settings);
    if (error) throw new BadRequestException(error);
    if (body.settings.alertChannelId) {
      const guild = this.discordClient.guilds.cache.get(body.guildId);
      const channel = await guild?.channels.fetch(body.settings.alertChannelId)
        .catch(() => null);
      const bot = guild?.members.me ||
        await guild?.members.fetchMe().catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText || !bot ||
          !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel) ||
          !channel.permissionsFor(bot)?.has(PermissionFlagsBits.SendMessages)) {
        throw new BadRequestException('Choose a guild text channel writable by Yuugen');
      }
    }
    return this.antiNuke.setConfig(body.guildId, body.settings);
  }

  @Post('alerts/:id/review')
  review(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { guildId: string; disposition: 'legitimate' | 'suspicious' },
    @Req() request: { user: { id: string } },
  ) {
    return this.antiNuke.reviewAlert(
      body.guildId, id, request.user.id, body.disposition,
    );
  }
}
