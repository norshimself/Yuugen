import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ChannelType, Client, PermissionFlagsBits } from 'discord.js';

const GUILDLESS_ROUTE = 'yuugen:allowGuildless';
const REQUIRE_GUILD_MANAGER = 'yuugen:requireGuildManager';

export const AllowGuildless = () => SetMetadata(GUILDLESS_ROUTE, true);
export const RequireGuildManager = () =>
  SetMetadata(REQUIRE_GUILD_MANAGER, true);

/**
 * All guild-specific web API requests must come from an authenticated Discord
 * member of the target guild. Settings endpoints additionally require Manage
 * Server permission. Bot-to-Discord slash commands use their own Discord
 * interaction context and are not affected by this HTTP guard.
 */
@Injectable()
export class GuildAccessGuard implements CanActivate {
  constructor(
    private readonly discordClient: Client,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: unknown = request.user?.id;

    if (
      typeof userId !== 'string' ||
      !/^\d{17,20}$/.test(userId)
    ) {
      throw new UnauthorizedException('Sign in with a Discord account');
    }

    const handlers = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(GUILDLESS_ROUTE, handlers)) {
      return true;
    }

    // Read exactly the same location the controller reads; do not allow a
    // harmless query guildId to authorize a different POST body guildId.
    const guildId: unknown =
      request.method === 'GET'
        ? request.query?.guildId
        : request.body?.guildId;

    if (typeof guildId !== 'string' || !/^\d{17,20}$/.test(guildId)) {
      throw new BadRequestException('A valid Discord guild ID is required');
    }

    const guild = this.discordClient.guilds.cache.get(guildId);
    if (!guild) {
      throw new ForbiddenException('Yuugen is not in this guild');
    }

    // Force-refresh membership instead of trusting potentially stale cache.
    const member = await guild.members
      .fetch({ user: userId, force: true })
      .catch(() => null);
    if (!member) {
      throw new ForbiddenException('You are not a member of this guild');
    }

    const needsManageGuild = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_GUILD_MANAGER,
      handlers,
    );
    if (needsManageGuild && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      throw new ForbiddenException('Manage Server permission is required');
    }

    // Join/play endpoints allow selecting a channel. Verify it belongs to this
    // guild and the caller can connect to it.
    const channelId: unknown = request.body?.channelId;
    if (channelId !== undefined && channelId !== null && channelId !== '') {
      if (typeof channelId !== 'string' || !/^\d{17,20}$/.test(channelId)) {
        throw new BadRequestException('Invalid voice channel ID');
      }
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (
        !channel ||
        (channel.type !== ChannelType.GuildVoice &&
          channel.type !== ChannelType.GuildStageVoice)
      ) {
        throw new BadRequestException('Voice channel does not belong to this guild');
      }
      if (!channel.permissionsFor(member)?.has(PermissionFlagsBits.Connect)) {
        throw new ForbiddenException('You cannot connect to this voice channel');
      }
    }

    return true;
  }
}
