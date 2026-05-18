import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS for frontend interaction
  app.enableCors();
  
  // Set global prefix
  app.setGlobalPrefix('api');
  
  // Use global pipes for validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // strip non-whitelisted properties
    transform: true, // transform payloads to match DTO types
  }));

  // Swagger setup for API documentation
  const config = new DocumentBuilder()
    .setTitle('Discord Bot API')
    .setDescription('API for controlling the Discord music bot and handling OAuth.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
    
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
