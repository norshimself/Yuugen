import {
  BadRequestException, Body, Controller, Get, Post, Query, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelType, Client, PermissionFlagsBits } from 'discord.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GuildAccessGuard, RequireGuildManager } from '../auth/guild-access.guard';
import { GuildAuditService } from '../../domain/audit/guild-audit.service';
import { isStructuralAuditType } from '../../domain/audit/guild-audit-structure-policy';
import {
  validateGuildAuditConfig, type GuildAuditConfig,
} from '../../domain/audit/guild-audit-policy';

/**
 * All routes require a live Discord Manage Server check through the same
 * JWT/GuildAccessGuard already used for guild settings and AutoMod.
 */
@Controller('audit')
@RequireGuildManager()
@UseGuards(JwtAuthGuard, GuildAccessGuard)
export class GuildAuditController {
  constructor(
    private readonly audit: GuildAuditService,
    private readonly client: Client,
    private readonly config: ConfigService,
  ) {}

  @Get()
  get(@Query('guildId') guildId: string) {
    return this.audit.getConfig(guildId);
  }

  @Get('history')
  history(@Query('guildId') guildId: string) {
    return this.audit.history(guildId);
  }

  @Post()
  async configure(@Body() body: { guildId: string; settings: GuildAuditConfig }) {
    const problem = validateGuildAuditConfig(body?.settings);
    if (problem) throw new BadRequestException(problem);
    const value = body.settings;
    // Disabling always works even after a channel has been deleted or the
    // bot has lost access. Never require stale permissions to turn logging off.
    if (value.enabled) {
      if (value.selectedEvents.some(type =>
          ['member_join', 'member_departure', 'member_timeout'].includes(type)) &&
          this.config.get<string>('ENABLE_GUILD_MEMBERS_INTENT') !== 'true') {
        throw new BadRequestException('Guild Members intent is required for member events');
      }
      if (value.selectedEvents.some(type =>
          (['member_ban', 'member_kick'].includes(type) || isStructuralAuditType(type))) &&
          this.config.get<string>('ENABLE_GUILD_MODERATION_INTENT') !== 'true') {
        throw new BadRequestException('Guild Moderation intent is required for ban/kick events');
      }
      const guild = this.client.guilds.cache.get(body.guildId);
      const channel = value.logChannelId
        ? await guild?.channels.fetch(value.logChannelId).catch(() => null)
        : null;
      const bot = guild?.members.me ||
        await guild?.members.fetchMe().catch(() => null);
      if (!guild || !bot || !channel || channel.type !== ChannelType.GuildText ||
          !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel) ||
          !channel.permissionsFor(bot)?.has(PermissionFlagsBits.SendMessages)) {
        throw new BadRequestException('Choose a writable guild text audit channel');
      }
      // Prevent accidental disclosure of member IDs/message IDs in #general.
      // Missing @everyone permission information fails closed.
      if (channel.permissionsFor(guild.roles.everyone)
          ?.has(PermissionFlagsBits.ViewChannel) !== false) {
        throw new BadRequestException('Audit channel must be private to staff');
      }
      if (value.selectedEvents.some(type =>
          type === 'member_kick' || isStructuralAuditType(type)) &&
          !bot.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
        throw new BadRequestException('Bot View Audit Log permission is required for selected audit-log events');
      }
    }
    return this.audit.setConfig(body.guildId, value);
  }
}
