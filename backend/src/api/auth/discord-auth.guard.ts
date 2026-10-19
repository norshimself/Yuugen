import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import * as crypto from 'node:crypto';

const STATE_COOKIE = 'yuugen_oauth_state';
const STATE_PATH = '/api/v1/auth';

/**
 * Stateless OAuth CSRF protection: a random state in a short-lived HttpOnly
 * cookie must match the state returned by Discord on the callback.
 */
@Injectable()
export class DiscordAuthGuard extends AuthGuard('discord') {
  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (!request.path?.endsWith('/auth/login')) return {};

    const state = crypto.randomBytes(32).toString('base64url');
    const response = context.switchToHttp().getResponse();
    response.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: STATE_PATH,
      maxAge: 5 * 60 * 1000,
    });
    return { state };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (request.path?.endsWith('/auth/callback')) {
      const expected = request.cookies?.[STATE_COOKIE];
      const actual = request.query?.state;
      const response = context.switchToHttp().getResponse();
      response.clearCookie(STATE_COOKIE, {
        path: STATE_PATH,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });

      if (
        typeof expected !== 'string' ||
        typeof actual !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(expected) ||
        !/^[A-Za-z0-9_-]{43}$/.test(actual) ||
        !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
      ) {
        throw new UnauthorizedException('Invalid Discord OAuth state');
      }
    }
    return (await super.canActivate(context)) as boolean;
  }
}
