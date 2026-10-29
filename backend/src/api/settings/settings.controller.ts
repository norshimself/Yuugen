import { BadRequestException, Controller, Get, Post, Body, Query, UseGuards, Req } from '@nestjs/common';
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
    const bot = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!bot) return { success: false, channels: [] };

    const channels = guild.channels.cache
      .filter((channel) => channel.type === ChannelType.GuildText &&
        !!channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) &&
        !!channel.permissionsFor(bot)?.has(PermissionFlagsBits.SendMessages) &&
        !!channel.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel))
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
    // The authenticated guard has already verified the manager and guild.
    // Validate only explicit channel changes; additionally recheck rules
    // visibility whenever acknowledgement is being enabled.
    if (!body?.settings || typeof body.settings !== 'object' ||
        Array.isArray(body.settings)) {
      throw new BadRequestException('Settings payload is required');
    }
    const existing = await this.settingsService.getSettings(body.guildId);
    const merged = { ...existing, ...body.settings };
    const chosen = new Set<string>();
    for (const field of [
      'welcomeChannelId', 'goodbyeChannelId', 'rulesChannelId',
    ] as const) {
      const value: unknown = body.settings[field];
      if (value === undefined || value === '' || value === null) continue;
      if (typeof value !== 'string' || !/^\d{17,20}$/.test(value)) {
        throw new BadRequestException('Invalid ' + field);
      }
      chosen.add(value);
    }
    if (merged.rulesAcknowledgementEnabled) {
      if (!merged.welcomeDmEnabled || !merged.rulesChannelId ||
          !/^\d{17,20}$/.test(merged.rulesChannelId)) {
        throw new BadRequestException('Rules acknowledgement requires welcome DM and rules channel');
      }
      chosen.add(merged.rulesChannelId);
    }
    if (chosen.size) {
      const guild = this.discordClient.guilds.cache.get(body.guildId);
      const bot = guild?.members.me ||
        await guild?.members.fetchMe().catch(() => null);
      if (!guild || !bot) {
        throw new BadRequestException('Bot is unavailable in this guild');
      }
      for (const channelId of chosen) {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText ||
            !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel) ||
            (channelId !== merged.rulesChannelId ||
              !merged.rulesAcknowledgementEnabled) &&
              !channel.permissionsFor(bot)?.has(PermissionFlagsBits.SendMessages)) {
          throw new BadRequestException('Select a text channel Yuugen can access');
        }
        // DMs may link only to a rules channel visible to new members.
        if (merged.rulesAcknowledgementEnabled &&
            channelId === merged.rulesChannelId &&
            channel.permissionsFor(guild.roles.everyone)
              ?.has(PermissionFlagsBits.ViewChannel) !== true) {
          throw new BadRequestException('Rules channel must be visible to new members');
        }
      }
    }
    return this.settingsService.updateSettings(body.guildId, body.settings);
  }
}
