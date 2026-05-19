import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from './session.entity';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const sessionId = request.cookies['session_id'];

    if (!sessionId) {
      throw new UnauthorizedException('Missing session cookie');
    }

    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });

    if (!session) {
      throw new UnauthorizedException('Invalid session');
    }

    if (session.expiresAt < new Date()) {
      await this.sessionRepository.delete(sessionId);
      throw new UnauthorizedException('Session expired');
    }

    // Attach user to request
    request.user = { id: session.userId };

    return true;
  }
}
