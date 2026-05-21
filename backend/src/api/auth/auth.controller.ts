import { Controller, Get, UseGuards, Req, Res, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { DiscordAuthGuard } from './discord-auth.guard';
import { SessionGuard } from './session.guard';
import { Session } from './session.entity';
import * as crypto from 'crypto';

@Controller('auth')
export class AuthController {
  constructor(
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    private jwtService: JwtService,
  ) {}
  @Get('login')
  @UseGuards(DiscordAuthGuard)
  async login() {
    // The guard redirects to Discord.
  }

  @Get('demo')
  async demo(@Res() res: any) {
    const demoUserId = 'demo_user_55555';

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const session = this.sessionRepository.create({
      id: sessionId,
      userId: demoUserId,
      expiresAt,
    });
    await this.sessionRepository.save(session);

    const accessToken = this.jwtService.sign({ userId: demoUserId });

    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(
      `${frontendUrl}/callback?access_token=${accessToken}&refresh_token=${sessionId}`,
    );
  }

  @Get('callback')
  @UseGuards(DiscordAuthGuard)
  async callback(@Req() req: any, @Res() res: any) {
    const user = req.user;

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const session = this.sessionRepository.create({
      id: sessionId,
      userId: user.id,
      expiresAt,
    });
    await this.sessionRepository.save(session);

    const accessToken = this.jwtService.sign({ userId: user.id });

    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(
      `${frontendUrl}/callback?access_token=${accessToken}&refresh_token=${sessionId}`,
    );
  }

  @Post('refresh')
  @UseGuards(SessionGuard)
  async refresh(@Req() req: any) {
    const accessToken = this.jwtService.sign({ userId: req.user.id });

    const sessionId =
      req.cookies?.['session_id'] ||
      req.headers?.['x-refresh-token'] ||
      req.body?.refreshToken ||
      req.body?.refresh_token;

    return {
      success: true,
      access_token: accessToken,
      refresh_token: sessionId,
    };
  }
}
