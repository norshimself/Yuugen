import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'node:crypto';
import { DiscordAuthGuard } from './discord-auth.guard';
import { SessionGuard } from './session.guard';
import { Session } from './session.entity';

const SESSION_COOKIE = 'yuugen_session';
const SESSION_PATH = '/api/v1/auth';
const CODE_LIFETIME_MS = 2 * 60 * 1000;
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
    private readonly jwtService: JwtService,
  ) {}

  @Get('login')
  @UseGuards(DiscordAuthGuard)
  async login() {
    // DiscordAuthGuard sends the user to Discord with a random OAuth state.
  }

  /**
   * The development-only login follows the same one-time code flow.
   * Real guild APIs reject demo identities.
   */
  @Get('demo')
  async demo(@Res() response: any) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.ENABLE_DEMO_LOGIN !== 'true'
    ) {
      throw new NotFoundException();
    }
    return this.redirectWithLoginCode('demo_user_55555', response);
  }

  @Get('callback')
  @UseGuards(DiscordAuthGuard)
  async callback(@Req() request: any, @Res() response: any) {
    const userId = request.user?.id;
    if (typeof userId !== 'string' || !/^\d{17,20}$/.test(userId)) {
      throw new UnauthorizedException('Discord did not return a valid user');
    }
    return this.redirectWithLoginCode(userId, response);
  }

  private async redirectWithLoginCode(userId: string, response: any) {
    // Keep a one-time, short-lived grant in the existing sessions table.
    // Only the SHA-256 digest is persisted, never the grant itself.
    const code = crypto.randomBytes(32).toString('base64url');
    const id = this.codeKey(code);
    const expiresAt = new Date(Date.now() + CODE_LIFETIME_MS);

    await this.sessionRepository.delete({ expiresAt: LessThan(new Date()) });
    await this.sessionRepository.save(
      this.sessionRepository.create({ id, userId, expiresAt }),
    );

    // Fragments are not sent in HTTP requests or Referer headers. The client
    // removes the fragment immediately and exchanges the grant once.
    const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
    const callback = new URL('/callback', frontend);
    callback.hash = `code=${code}`;
    return response.redirect(callback.toString());
  }

  private codeKey(code: string): string {
    return `oauth-code:${crypto.createHash('sha256').update(code).digest('hex')}`;
  }

  @Post('exchange')
  async exchange(
    @Body('code') code: unknown,
    @Res({ passthrough: true }) response: any,
  ) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
      throw new UnauthorizedException('Invalid or expired sign-in code');
    }

    // Atomic delete + RETURNING prevents replay even under concurrent calls.
    const consumed = await this.sessionRepository
      .createQueryBuilder()
      .delete()
      .from(Session)
      .where('"id" = :id AND "expiresAt" > :now', {
        id: this.codeKey(code),
        now: new Date(),
      })
      .returning('*')
      .execute();

    const userId: unknown = consumed.raw?.[0]?.userId;
    if (typeof userId !== 'string') {
      throw new UnauthorizedException('Invalid or expired sign-in code');
    }

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await this.sessionRepository.save(
      this.sessionRepository.create({
        id: sessionId,
        userId,
        expiresAt,
      }),
    );

    response.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: SESSION_PATH,
      expires: expiresAt,
    });

    return {
      success: true,
      access_token: this.jwtService.sign({ userId }),
    };
  }

  @Post('refresh')
  @UseGuards(SessionGuard)
  async refresh(@Req() request: any) {
    return {
      success: true,
      access_token: this.jwtService.sign({ userId: request.user.id }),
    };
  }

  @Post('logout')
  async logout(@Req() request: any, @Res({ passthrough: true }) response: any) {
    const sessionId = request.cookies?.[SESSION_COOKIE];
    if (typeof sessionId === 'string' && /^[a-f0-9-]{36}$/i.test(sessionId)) {
      await this.sessionRepository.delete({ id: sessionId });
    }

    response.clearCookie(SESSION_COOKIE, {
      path: SESSION_PATH,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    // Drop cookies that older versions of Yuugen might have set.
    response.clearCookie('session_id', { path: '/' });
    return { success: true };
  }
}
