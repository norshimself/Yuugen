import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { WsAdapter } from '@nestjs/platform-ws';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Register native WebSocket adapter
  app.useWebSocketAdapter(new WsAdapter(app));

  // Enable CORS for frontend interaction
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors({
    origin: corsOrigin || true,
    credentials: true,
    allowedHeaders:
      'Content-Type, Accept, Authorization, x-api-key, x-refresh-token',
  });

  // Set global prefix
  app.setGlobalPrefix('api');

  // Enable API versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Use global pipes for validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip non-whitelisted properties
      transform: true, // transform payloads to match DTO types
    }),
  );

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: false, // Disable CSP for development ease with Swagger
    }),
  );

  // Response compression
  app.use(compression());

  // Cookie parser
  app.use(cookieParser());

  // Graceful shutdown
  app.enableShutdownHooks();

  // Global Interceptors
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Global Filters
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger setup for API documentation
  const config = new DocumentBuilder()
    .setTitle('Discord Bot API')
    .setDescription(
      'API for controlling the Discord music bot and handling OAuth.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
