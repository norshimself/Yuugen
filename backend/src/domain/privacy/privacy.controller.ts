import {
  BadRequestException, Body, Controller, Get, Header, Post, Query,
  Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../api/auth/jwt-auth.guard';
import { FirstPartyRequestGuard } from '../../api/auth/first-party-request.guard';
import { GuildAccessGuard, RequireGuildManager } from '../../api/auth/guild-access.guard';
import {
  assertDiscordId, assertOwnErasureRequest,
} from './privacy-policy';
import { PrivacyService } from './privacy.service';

function authenticatedUser(request: {user?: {id?: unknown}}): string {
  const id = request.user?.id;
  try { assertDiscordId(id, 'authenticated user ID'); }
  catch { throw new UnauthorizedException('Sign in with a Discord account'); }
  return id;
}

@Controller('privacy/me')
@UseGuards(JwtAuthGuard)
export class PrivacySelfController {
  constructor(private readonly privacy: PrivacyService) {}

  /** The JWT supplies the identity; no caller-supplied target ID. */
  @Get('export')
  @Header('Cache-Control', 'no-store')
  async export(@Req() request: {user?: {id?: unknown}}) {
    return this.privacy.exportSelf(authenticatedUser(request));
  }

  /**
   * Requires a fresh explicit phrase and scope, plus browser origin/JSON
   * verification. This removes only user-global economy and ephemeral auth.
   * No moderation audit records are silently deleted.
   */
  @Post('erase')
  @UseGuards(FirstPartyRequestGuard)
  @Header('Cache-Control', 'no-store')
  async erase(
    @Req() request: {user?: {id?: unknown}},
    @Body() body: unknown,
    @Res({passthrough:true}) response: {
      clearCookie: (name:string, options:{path:string;httpOnly?:boolean;
        secure?:boolean;sameSite?:'lax'})=>void;
    },
  ) {
    const userId = authenticatedUser(request);
    try { assertOwnErasureRequest(body); }
    catch { throw new BadRequestException('Explicit privacy erasure confirmation required'); }
    const result = await this.privacy.eraseSelf(userId);
    response.clearCookie('yuugen_session',{
      path:'/api/v1/auth',httpOnly:true,
      secure:process.env.NODE_ENV==='production',sameSite:'lax',
    });
    response.clearCookie('session_id',{path:'/'});
    return result;
  }
}

/** Separate manager-only namespace: never grant guild access from a user ID. */
@Controller('privacy/guild')
@RequireGuildManager()
@UseGuards(JwtAuthGuard, GuildAccessGuard)
export class PrivacyGuildController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('export')
  @Header('Cache-Control', 'no-store')
  async export(@Query('guildId') guildId: string) {
    // GuildAccessGuard has force-fetched membership and Manage Server.
    return this.privacy.exportGuild(guildId);
  }
}
