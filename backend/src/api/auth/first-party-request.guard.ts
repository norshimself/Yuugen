import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

/**
 * Cookie-sensitive POST requests must be JSON requests with a custom header.
 * A cross-site form cannot set it; cross-origin fetch requires CORS preflight.
 */
@Injectable()
export class FirstPartyRequestGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (request.headers?.['x-yuugen-client'] !== 'web') {
      throw new ForbiddenException('Untrusted session request');
    }

    const contentType = request.headers?.['content-type'];
    if (
      typeof contentType !== 'string' ||
      !contentType.toLowerCase().startsWith('application/json')
    ) {
      throw new UnsupportedMediaTypeException('JSON requests required');
    }

    const origin: unknown = request.headers?.origin;
    const allowedOrigins = (
      process.env.CORS_ORIGIN ||
      process.env.FRONTEND_URL ||
      'http://localhost:3000'
    )
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (origin !== undefined &&
        (typeof origin !== 'string' || !allowedOrigins.includes(origin))) {
      throw new ForbiddenException('Untrusted request origin');
    }
    return true;
  }
}
