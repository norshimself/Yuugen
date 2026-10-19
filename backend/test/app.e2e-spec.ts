import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from '../src/api/app/app.controller';
import { AppService } from '../src/api/app/app.service';
import { StatusService } from '../src/shared/status.service';

describe('Health endpoints (isolated e2e)', () => {
  let app: INestApplication<App>;
  const status = {
    getStatus: jest.fn().mockReturnValue('Bot is online and responding!'),
    checkReadiness: jest.fn().mockResolvedValue({
      status: 'ready',
      dependencies: { database: 'up', discord: 'up', lavalink: 'up' },
    }),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: StatusService, useValue: status },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns process liveness at the actual versioned route', () => {
    return request(app.getHttpServer())
      .get('/api/v1/status')
      .expect(200)
      .expect('Bot is online and responding!');
  });

  it('returns ready with all dependencies up', () => {
    return request(app.getHttpServer())
      .get('/api/v1/ready')
      .expect(200)
      .expect({
        status: 'ready',
        dependencies: { database: 'up', discord: 'up', lavalink: 'up' },
      });
  });

  it('returns HTTP 503 when a dependency is unavailable', async () => {
    status.checkReadiness.mockResolvedValueOnce({
      status: 'unavailable',
      dependencies: { database: 'up', discord: 'down', lavalink: 'up' },
    });
    await request(app.getHttpServer())
      .get('/api/v1/ready')
      .expect(503);
  });
});
