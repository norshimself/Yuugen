import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from './session.entity';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    // A refresh session is a server-issued HttpOnly cookie. No refresh token
    // from request body, headers, or JavaScript-readable storage is accepted.
    const sessionId: unknown = request.cookies?.yuugen_session;

    if (
      typeof sessionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
    ) {
      throw new UnauthorizedException('Sign in required');
    }

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });

    if (!session || session.expiresAt <= new Date()) {
      if (session) await this.sessionRepository.delete({ id: sessionId });
      throw new UnauthorizedException('Session expired or revoked');
    }

    request.user = { id: session.userId };
    return true;
  }
}
