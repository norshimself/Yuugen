import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './api/app/app.controller';
import { AppService } from './api/app/app.service';
import { StatusService } from './shared/status.service';

describe('AppController', () => {
  let controller: AppController;
  const readiness = {
    status: 'ready' as const,
    dependencies: {
      database: 'up' as const,
      discord: 'up' as const,
      lavalink: 'up' as const,
    },
  };
  const status = {
    getStatus: jest.fn().mockReturnValue('Yuugen API is responding.'),
    checkReadiness: jest.fn().mockResolvedValue(readiness),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: StatusService, useValue: status },
      ],
    }).compile();
    controller = module.get<AppController>(AppController);
  });

  it('returns the application greeting', () => {
    expect(controller.getHello()).toBe('Hello World!');
  });

  it('returns a successful readiness report', async () => {
    await expect(controller.getReadiness()).resolves.toEqual(readiness);
  });

  it('rejects unready dependencies with HTTP 503', async () => {
    status.checkReadiness.mockResolvedValueOnce({
      status: 'unavailable',
      dependencies: {
        database: 'up', discord: 'down', lavalink: 'up',
      },
    });
    await expect(controller.getReadiness()).rejects.toMatchObject({
      status: 503,
    });
  });
});
