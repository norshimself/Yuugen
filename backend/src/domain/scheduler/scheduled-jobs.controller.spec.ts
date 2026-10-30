import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ScheduledJobsController } from './scheduled-jobs.controller';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { JwtAuthGuard } from '../../api/auth/jwt-auth.guard';
import { GuildAccessGuard } from '../../api/auth/guild-access.guard';

const guildId = '123456789012345678';
const moderatorId = '234567890123456789';
const request = { user: { id: moderatorId } };

function setup() {
  const jobs = {
    statusCounts: jest.fn().mockResolvedValue([{ status: 'dead', count: '1' }]),
    failedJobs: jest.fn().mockResolvedValue([{
      id: '7', kind: 'reminder_send', status: 'dead',
      attempts: 5, lastErrorCode: 'retry_exhausted',
    }]),
    cancel: jest.fn().mockResolvedValue(true),
    retryDead: jest.fn().mockResolvedValue(true),
  };
  return {
    jobs,
    controller: new ScheduledJobsController(jobs as unknown as ScheduledJobsService),
  };
}

describe('ScheduledJobsController', () => {
  it('requires JWT and fresh Manage Server guild authorization on every route', () => {
    expect(Reflect.getMetadata('yuugen:requireGuildManager', ScheduledJobsController))
      .toBe(true);
    const guards = Reflect.getMetadata('__guards__', ScheduledJobsController) as Function[];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(GuildAccessGuard);
    expect(Reflect.getMetadata('yuugen:allowGuildless', ScheduledJobsController))
      .not.toBe(true);
  });

  it('only returns metadata summaries and scopes them to authorized guild', async () => {
    const { jobs, controller } = setup();
    expect(await controller.status(guildId)).toEqual({
      counts: [{ status: 'dead', count: '1' }],
    });
    expect(await controller.failed(guildId)).toEqual({
      jobs: [{ id: '7', kind: 'reminder_send', status: 'dead',
        attempts: 5, lastErrorCode: 'retry_exhausted' }],
    });
    expect(jobs.statusCounts).toHaveBeenCalledWith(guildId);
    expect(jobs.failedJobs).toHaveBeenCalledWith(guildId, 20);
  });

  it('uses the authenticated actor ID for cancel and retry', async () => {
    const { jobs, controller } = setup();
    expect(await controller.cancel({ guildId, jobId: '7' }, request))
      .toEqual({ changed: true });
    expect(jobs.cancel).toHaveBeenCalledWith(guildId, '7', moderatorId);
    expect(await controller.retry({ guildId, jobId: '7' }, request))
      .toEqual({ changed: true });
    expect(jobs.retryDead).toHaveBeenCalledWith(guildId, '7', moderatorId);
  });

  it.each([
    null,
    [],
    {},
    { guildId, jobId: '0' },
    { guildId, jobId: '-1' },
    { guildId, jobId: '9223372036854775808' },
    { guildId, jobId: 7 },
    { guildId: 'bad', jobId: '7' },
    { guildId, jobId: '7', payload: { message: 'malicious' } },
  ])('rejects malformed and extra fields without writing: %j', async (input) => {
    const { jobs, controller } = setup();
    await expect(controller.cancel(input, request)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.retry(input, request)).rejects.toBeInstanceOf(BadRequestException);
    expect(jobs.cancel).not.toHaveBeenCalled();
    expect(jobs.retryDead).not.toHaveBeenCalled();
  });

  it('does not claim to retry uncertain outcomes; DB service is the final authority', async () => {
    const { jobs, controller } = setup();
    jobs.retryDead.mockResolvedValueOnce(false);
    expect(await controller.retry({ guildId, jobId: '7' }, request))
      .toEqual({ changed: false });
  });
});
