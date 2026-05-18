import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    
    // Check if it's an HTTP request (not a Discord interaction or WebSocket)
    if (request && request.method) {
      const { method, url } = request;
      const now = Date.now();

      return next
        .handle()
        .pipe(
          tap(() => {
            const response = context.switchToHttp().getResponse();
            const { statusCode } = response;
            this.logger.log(`${method} ${url} ${statusCode} - ${Date.now() - now}ms`);
          }),
        );
    }

    return next.handle();
  }
}
