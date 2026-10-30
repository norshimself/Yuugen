import { ConfigService } from '@nestjs/config';
import { ScheduledJobsRegistry } from './scheduled-jobs.registry';
import { ScheduledJobsWorker } from './scheduled-jobs.worker';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { type ClaimedJob } from './scheduler-policy';

const job: ClaimedJob = {
  id:'111',guildId:'123456789012345678',
  kind:'reminder_send',payload:{reminderId:1},
  attempts:1,maxAttempts:5,
  leaseToken:'44444444-4444-4444-4444-444444444444',
  leaseOwner:'worker-test',cancelRequested:false,
};

function setup(enabled=true) {
  const queue = {
    reconcileExpiredLeases:jest.fn().mockResolvedValue(0),
    claim:jest.fn().mockResolvedValue([job]),
    leaseState:jest.fn().mockResolvedValue({alive:true,cancelRequested:false}),
    heartbeat:jest.fn().mockResolvedValue(true),
    settle:jest.fn().mockResolvedValue(true),
  };
  const handlers=new ScheduledJobsRegistry();
  const config={get:jest.fn().mockReturnValue(enabled?'true':'false')};
  const worker=new ScheduledJobsWorker(
    queue as unknown as ScheduledJobsService,
    handlers, config as unknown as ConfigService,
  );
  return {worker,queue,handlers};
}

describe('ScheduledJobsWorker safety gates',()=>{
  it('never starts timers, recovers leases or dispatches with the opt-in flag off',async()=>{
    const {worker,queue}=setup(false);
    worker.onModuleInit();
    await worker.runOnce(); // even accidental direct invocation must be inert
    await worker.onModuleDestroy();
    expect(queue.reconcileExpiredLeases).not.toHaveBeenCalled();
    expect(queue.claim).not.toHaveBeenCalled();
  });

  it('reconciles expired leases but never claims when no handlers are registered',async()=>{
    const {worker,queue}=setup();
    queue.reconcileExpiredLeases.mockResolvedValueOnce(2);
    await worker.runOnce();
    expect(queue.reconcileExpiredLeases).toHaveBeenCalledTimes(1);
    expect(queue.claim).not.toHaveBeenCalled();
  });

  it('dispatches a registered handler and journals completion',async()=>{
    const {worker,queue,handlers}=setup();
    const execute=jest.fn().mockResolvedValue({outcome:'completed'});
    handlers.register('reminder_send',{preflight:async()=>({state:'ready'}),execute});
    await worker.runOnce();
    expect(queue.claim).toHaveBeenCalledWith(expect.any(String),1,['reminder_send']);
    expect(execute).toHaveBeenCalledWith(job,{
      assertActive:expect.any(Function),
    });
    expect(queue.settle).toHaveBeenCalledWith(job,{outcome:'completed'});
    await worker.onModuleDestroy();
  });

  it('cancellation before dispatch never executes remote action',async()=>{
    const {worker,queue,handlers}=setup();
    const execute=jest.fn();
    handlers.register('reminder_send',{preflight:async()=>({state:'ready'}),execute});
    queue.leaseState.mockResolvedValueOnce({alive:true,cancelRequested:true});
    await worker.runOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(queue.settle).toHaveBeenCalledWith(job,{
      outcome:'canceled',reasonCode:'cancel_before_dispatch',
    });
  });

  it('an ambiguous handler error is held for review, not retried',async()=>{
    const {worker,queue,handlers}=setup();
    handlers.register('reminder_send',{
      preflight:async()=>({state:'ready'}),
      execute:async()=>{throw new Error('ETIMEDOUT after Discord accepted');},
    });
    await worker.runOnce();
    expect(queue.settle).toHaveBeenCalledWith(job,{
      outcome:'needs_review',reasonCode:'unknown_outcome',
    });
  });

  it('a lost lease never finalizes as success',async()=>{
    const {worker,queue,handlers}=setup();
    handlers.register('reminder_send',{preflight:async()=>({state:'ready'}),execute:async()=>({outcome:'completed'})});
    queue.leaseState.mockResolvedValueOnce({alive:false,cancelRequested:false});
    await worker.runOnce();
    expect(queue.settle).not.toHaveBeenCalled();
  });

  it('never claims unregistered future job kinds',async()=>{
    const {worker,queue,handlers}=setup();
    const execute=jest.fn().mockResolvedValue({outcome:'completed'});
    const eventJob={...job,kind:'event_notice' as const,payload:{eventId:7}};
    queue.claim.mockResolvedValueOnce([eventJob]);
    handlers.register('event_notice',{preflight:async()=>({state:'ready'}),execute});
    await worker.runOnce();
    expect(queue.claim).toHaveBeenCalledWith(expect.any(String),1,['event_notice']);
    expect(handlers.kinds).toEqual(['event_notice']);
    expect(execute).toHaveBeenCalledWith(eventJob,{
      assertActive:expect.any(Function),
    });
    expect(queue.settle).toHaveBeenCalledWith(eventJob,{outcome:'completed'});
  });

  it('cannot register two handlers for the same kind',()=>{
    const {handlers}=setup();
    handlers.register('event_notice',{preflight:async()=>({state:'ready'}),execute:async()=>({outcome:'completed'})});
    expect(()=>handlers.register('event_notice',{
      preflight:async()=>({state:'ready'}),
      execute:async()=>({outcome:'completed'}),
    })).toThrow('Duplicate');
  });
  it('rejects handlers that omit live authorization/resource preflight',()=>{
    const {handlers}=setup();
    expect(()=>handlers.register('reminder_send',{
      execute:async()=>({outcome:'completed'}),
    } as any)).toThrow('Invalid scheduler handler');
  });

  it('quarantines corrupted stored payloads without executing a handler',async()=>{
    const {worker,queue,handlers}=setup();
    const execute=jest.fn();
    const preflight=jest.fn();
    handlers.register('reminder_send',{preflight,execute});
    queue.claim.mockResolvedValueOnce([{
      ...job,payload:{reminderId:1,unapprovedContent:'@everyone'},
    }]);
    await worker.runOnce();
    expect(preflight).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(queue.settle).toHaveBeenCalledWith(
      expect.objectContaining({id:job.id}),
      {outcome:'needs_review',reasonCode:'invalid_claimed_job'},
    );
  });

  it('does not dispatch after a failed initial permission/resource preflight',async()=>{
    const {worker,queue,handlers}=setup();
    const execute=jest.fn();
    const preflight=jest.fn().mockResolvedValue({
      state:'needs_review',reasonCode:'bot_permission_revoked',
    });
    handlers.register('reminder_send',{preflight,execute});
    await worker.runOnce();
    expect(preflight).toHaveBeenCalledWith(job);
    expect(execute).not.toHaveBeenCalled();
    expect(queue.settle).toHaveBeenCalledWith(job,{
      outcome:'needs_review',reasonCode:'bot_permission_revoked',
    });
  });

  it('classifies deleted resources before dispatch as canceled',async()=>{
    const {worker,queue,handlers}=setup();
    const execute=jest.fn();
    handlers.register('reminder_send',{
      preflight:async()=>({state:'canceled',reasonCode:'resource_missing'}),
      execute,
    });
    await worker.runOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(queue.settle).toHaveBeenCalledWith(job,{
      outcome:'canceled',reasonCode:'resource_missing',
    });
  });

  it('rechecks permissions after async preflight before starting handler',async()=>{
    const {worker,queue,handlers}=setup();
    const execute=jest.fn();
    const preflight=jest.fn()
      .mockResolvedValueOnce({state:'ready'})
      .mockResolvedValueOnce({state:'needs_review',reasonCode:'permission_changed'});
    handlers.register('reminder_send',{preflight,execute});
    await worker.runOnce();
    expect(preflight).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
    expect(queue.settle).toHaveBeenCalledWith(job,{
      outcome:'needs_review',reasonCode:'unknown_outcome',
    });
  });

  it('notices cancellation that races a slow live authorization fetch',async()=>{
    const {worker,queue,handlers}=setup();
    const execute=jest.fn();
    let checks=0;
    let release: (()=>void) | undefined;
    const preflight=jest.fn().mockImplementation(async()=>{
      checks++;
      if (checks===2) {
        await new Promise<void>((resolve)=>{release=resolve;});
      }
      return {state:'ready'};
    });
    handlers.register('reminder_send',{preflight,execute});
    queue.leaseState
      .mockResolvedValueOnce({alive:true,cancelRequested:false})
      .mockResolvedValueOnce({alive:true,cancelRequested:false})
      .mockResolvedValueOnce({alive:true,cancelRequested:true});

    const run=worker.runOnce();
    for(let i=0;i<20 && !release;i++) await Promise.resolve();
    expect(release).toBeDefined();
    release!();
    await run;
    expect(execute).not.toHaveBeenCalled();
    expect(queue.leaseState).toHaveBeenCalledTimes(3);
    expect(queue.settle).toHaveBeenCalledWith(job,{
      outcome:'needs_review',reasonCode:'unknown_outcome',
    });
  });

  it('parks a hung provider operation after a bounded deadline',async()=>{
    jest.useFakeTimers();
    try {
      const {worker,queue,handlers}=setup();
      const execute=jest.fn().mockImplementation(()=>new Promise(()=>{}));
      handlers.register('reminder_send',{preflight:async()=>({state:'ready'}),execute});
      const run=worker.runOnce();
      await jest.advanceTimersByTimeAsync(0);
      expect(execute).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(5*60_000);
      await run;
      expect(queue.settle).toHaveBeenCalledWith(job,{
        outcome:'needs_review',reasonCode:'execution_timeout',
      });
      expect(queue.settle).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not hang Nest shutdown on an indefinitely pending handler',async()=>{
    jest.useFakeTimers();
    try {
      const {worker,queue,handlers}=setup();
      const execute=jest.fn().mockImplementation(()=>new Promise(()=>{}));
      handlers.register('reminder_send',{preflight:async()=>({state:'ready'}),execute});
      worker.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      expect(execute).toHaveBeenCalledTimes(1);
      const shuttingDown=worker.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(5_000);
      await shuttingDown;
      await jest.advanceTimersByTimeAsync(60_000);
      expect(queue.heartbeat).not.toHaveBeenCalled();
      expect(queue.settle).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('bounds a hung guild permission preflight before any remote effect',async()=>{
    jest.useFakeTimers();
    try {
      const {worker,queue,handlers}=setup();
      const execute=jest.fn();
      handlers.register('reminder_send',{
        preflight:async()=>new Promise(()=>{}),
        execute,
      });
      const run=worker.runOnce();
      await jest.advanceTimersByTimeAsync(5*60_000);
      await run;
      expect(execute).not.toHaveBeenCalled();
      expect(queue.settle).toHaveBeenCalledWith(job,{
        outcome:'needs_review',reasonCode:'execution_timeout',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops late actions after a failed lease heartbeat',async()=>{
    jest.useFakeTimers();
    try {
      const {worker,queue,handlers}=setup();
      const effect=jest.fn();
      let resume: (()=>void)|undefined;
      queue.heartbeat.mockResolvedValueOnce(false);
      handlers.register('reminder_send',{
        preflight:async()=>({state:'ready'}),
        execute:async(_job,context)=>{
          await new Promise<void>(resolve=>{resume=resolve;});
          await context.assertActive();
          effect();
          return {outcome:'completed'};
        },
      });
      const run=worker.runOnce();
      await jest.advanceTimersByTimeAsync(0);
      expect(resume).toBeDefined();
      await jest.advanceTimersByTimeAsync(15_000);
      resume!();
      await run;
      expect(effect).not.toHaveBeenCalled();
      // A lost lease cannot settle; the reaper will park it for review.
      expect(queue.settle).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rechecks permissions for each action and parks later uncertainty',async()=>{
    const {worker,queue,handlers}=setup();
    const external=jest.fn();
    const preflight=jest.fn()
      .mockResolvedValueOnce({state:'ready'})
      .mockResolvedValueOnce({state:'ready'})
      .mockResolvedValueOnce({state:'ready'})
      .mockResolvedValueOnce({state:'needs_review',reasonCode:'permission_changed'});
    handlers.register('reminder_send',{
      preflight,
      execute:async(_job,context)=>{
        await context.assertActive();
        external();
        await context.assertActive();
        external();
        return {outcome:'completed'};
      },
    });
    await worker.runOnce();
    expect(preflight).toHaveBeenCalledTimes(4);
    expect(external).toHaveBeenCalledTimes(1);
    expect(queue.settle).toHaveBeenCalledWith(job,{
      outcome:'needs_review',reasonCode:'unknown_outcome',
    });
  });

});
