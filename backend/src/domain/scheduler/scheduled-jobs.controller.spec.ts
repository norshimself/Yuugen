import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ScheduledJobsController } from './scheduled-jobs.controller';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { ScheduledJobsRegistry } from './scheduled-jobs.registry';
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
    resolveReviewedJob: jest.fn().mockResolvedValue(true),
    healthMetrics: jest.fn().mockResolvedValue({
      dueRunnable:'2',awaitingHandler:'1',expiredLeases:'0',
      needsReview:'3',dead:'1',oldestDueSeconds:'120',
    }),
  };
  const registry = new ScheduledJobsRegistry();
  return {
    jobs, registry,
    controller: new ScheduledJobsController(jobs as unknown as ScheduledJobsService, registry),
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

  it('reports manager-only queue health with registered handler kinds',async()=>{
    const {jobs,registry,controller}=setup();
    expect(await controller.metrics(guildId)).toEqual({metrics:{
      dueRunnable:'2',awaitingHandler:'1',expiredLeases:'0',
      needsReview:'3',dead:'1',oldestDueSeconds:'120',
    }});
    expect(jobs.healthMetrics).toHaveBeenCalledWith(guildId,[]);
    registry.register('reminder_send',{
      preflight:async()=>({state:'ready'}),
      execute:async()=>({outcome:'completed'}),
    });
    await controller.metrics(guildId);
    expect(jobs.healthMetrics).toHaveBeenLastCalledWith(guildId,['reminder_send']);
  });

  it('records only explicitly confirmed terminal review outcomes', async () => {
    const {jobs,controller}=setup();
    const payload={guildId,jobId:'7',confirmed:true,disposition:'completed'};
    expect(await controller.resolve(payload,request)).toEqual({changed:true});
    expect(jobs.resolveReviewedJob).toHaveBeenCalledWith(
      guildId,'7',moderatorId,'completed',
    );
    expect(await controller.resolve({...payload,disposition:'canceled'},request))
      .toEqual({changed:true});
    expect(jobs.resolveReviewedJob).toHaveBeenLastCalledWith(
      guildId,'7',moderatorId,'canceled',
    );
    jobs.resolveReviewedJob.mockResolvedValueOnce(false);
    expect(await controller.resolve(payload,request)).toEqual({changed:false});
  });

  it.each([
    null, {},
    {guildId,jobId:'7',disposition:'completed'},
    {guildId,jobId:'7',confirmed:false,disposition:'completed'},
    {guildId,jobId:'7',confirmed:true,disposition:'pending'},
    {guildId,jobId:'9223372036854775808',confirmed:true,disposition:'completed'},
    {guildId,jobId:'7',confirmed:true,disposition:'completed',rawEvidence:'a secret'},
  ])('refuses unconfirmed, replay or arbitrary evidence input: %j', async(input)=>{
    const {jobs,controller}=setup();
    await expect(controller.resolve(input,request)).rejects.toBeInstanceOf(BadRequestException);
    expect(jobs.resolveReviewedJob).not.toHaveBeenCalled();
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
