import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Check if it's an HTTP request (not a Discord interaction or WebSocket)
    if (request && request.method) {
      const { method } = request;
      // OAuth callbacks contain a short-lived code/state in the query.
      // Never log raw request.url, originalUrl, query, headers or body.
      // The router's declared route template contains no user-supplied data.
      const template: unknown = request.route?.path;
      const route = typeof template === 'string' &&
        /^\/[A-Za-z0-9/_:-]{1,180}$/.test(template)
        ? template.replace(/\d{17,20}/g, ':id') : '<unmatched>';
      const now = Date.now();

      return next.handle().pipe(
        tap(() => {
          const response = context.switchToHttp().getResponse();
          const { statusCode } = response;
          this.logger.log(
            `${method} ${route} ${statusCode} - ${Date.now() - now}ms`,
          );
        }),
      );
    }

    return next.handle();
  }
}
