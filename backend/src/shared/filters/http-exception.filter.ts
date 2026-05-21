import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Check if it's an HTTP request
    if (!request || !request.url) {
      return;
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    this.logger.error(
      `${request.method} ${request.url} ${status} - Error: ${JSON.stringify(message)}`,
      exception instanceof Error ? exception.stack : '',
    );

    // Ensure we don't try to send a response if headers are already sent
    if (response.headersSent) {
      return;
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message:
        typeof message === 'object'
          ? (message as any).message || message
          : message,
    });
  }
}
