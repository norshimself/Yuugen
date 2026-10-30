import { DataSource } from 'typeorm';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { type ClaimedJob } from './scheduler-policy';

const guild = '123456789012345678';
const actor = '234567890123456789';
const payload = {
  guildId: guild,kind:'reminder_send' as const,idempotencyKey:'reminder:1',
  payload:{reminderId:1},runAt:'2026-11-01T00:00:00Z',
};
const claimed: ClaimedJob = {
  id:'9007199254740993',guildId:guild,kind:'reminder_send',
  payload:{reminderId:1},attempts:2,maxAttempts:5,
  leaseToken:'44444444-4444-4444-4444-444444444444',
  leaseOwner:'yuugen-worker',cancelRequested:false,
};

function setup() {
  const query=jest.fn().mockResolvedValue([]);
  const svc=new ScheduledJobsService({query} as unknown as DataSource);
  return {svc,query};
}

describe('ScheduledJobsService: PostgreSQL SQL contracts', () => {
  it('inserts a job once and audits the successful insert atomically', async () => {
    const {svc,query}=setup();
    query.mockResolvedValueOnce([{id:'15',status:'pending'}]);
    await expect(svc.enqueue(payload)).resolves.toEqual({
      id:'15',status:'pending',created:true,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT');
    expect(query.mock.calls[0][0]).toContain("SELECT id,'queued' FROM inserted");
    expect(query.mock.calls[0][1]).toEqual([
      guild,'reminder_send','reminder:1','{"reminderId":1}','2026-11-01T00:00:00Z',5,
    ]);
  });

  it('accepts matching idempotent replays, rejects changed payloads or time', async () => {
    const {svc,query}=setup();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      id:'15',status:'completed',identical:true,
    }]);
    expect(await svc.enqueue(payload)).toEqual({
      id:'15',status:'completed',created:false,
    });
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      id:'15',status:'completed',identical:false,
    }]);
    await expect(svc.enqueue(payload)).rejects.toThrow('Idempotency key collision');
  });

  it('refuses unvalidated payload data before touching PostgreSQL', async () => {
    const {svc,query}=setup();
    await expect(svc.enqueue({...payload,payload:{reminderId:0}}))
      .rejects.toThrow('reminder');
    await expect(svc.enqueue({...payload,runAt:'tomorrow'}))
      .rejects.toThrow('UTC');
    expect(query).not.toHaveBeenCalled();
  });

  it('claims with database-time, row locks, UUID fencing and an audit entry', async () => {
    const {svc,query}=setup();
    query.mockResolvedValueOnce([claimed]);
    expect(await svc.claim('worker-1',1)).toEqual([claimed]);
    const sql=query.mock.calls[0][0] as string;
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('clock_timestamp()');
    expect(sql).toContain('gen_random_uuid()');
    expect(sql).toContain('"attempts"=j."attempts"+1');
    expect(sql).toContain("'claimed'");
    expect(query.mock.calls[0][1]).toEqual([1,'worker-1']);
    await expect(svc.claim('bad token with spaces')).rejects.toThrow('worker');
    await expect(svc.claim('worker-1',20)).rejects.toThrow('batch');
  });

  it('parks expired running jobs for human review, never auto-requeues', async () => {
    const {svc,query}=setup();
    query.mockResolvedValueOnce([{jobId:'1'},{jobId:'2'}]);
    expect(await svc.reconcileExpiredLeases()).toBe(2);
    const sql=query.mock.calls[0][0] as string;
    expect(sql).toContain("'needs_review'");
    expect(sql).toContain('"leaseUntil"<=clock_timestamp()');
    expect(sql).not.toContain("SET \"status\"='pending'");
  });

  it('checks a live lease, cancellation and stale token via owned predicates', async () => {
    const {svc,query}=setup();
    query.mockResolvedValueOnce([{cancelRequested:true}]);
    expect(await svc.leaseState(claimed)).toEqual({
      alive:true,cancelRequested:true,
    });
    query.mockResolvedValueOnce([]);
    expect(await svc.leaseState(claimed)).toEqual({
      alive:false,cancelRequested:false,
    });
    query.mockResolvedValueOnce([]);
    expect(await svc.heartbeat(claimed)).toBe(false);
    expect(query.mock.calls[2][0]).toContain('"leaseToken"=$2::uuid');
  });

  it('fences completion and calculates no-side-effect retry delay', async () => {
    const {svc,query}=setup();
    query.mockResolvedValueOnce([{id:claimed.id}]);
    expect(await svc.settle(claimed,{
      outcome:'retry',reasonCode:'rate_limited',
    })).toBe(true);
    const [sql,args]=query.mock.calls[0];
    expect(sql).toContain('"leaseOwner"=$3');
    expect(sql).toContain('"leaseUntil">clock_timestamp()');
    // A cancel that races a known-no-effect retry must become final canceled,
    // not an unclaimable pending job with cancelRequested=true.
    expect(sql).toContain('WHEN "cancelRequested" AND $4=\'pending\'');
    expect(sql).toContain('THEN \'canceled\' ELSE $4 END');
    expect(sql).toContain('WHEN $4=\'pending\' AND NOT "cancelRequested"');
    expect(sql).toContain('FROM settled');
    expect(args[0]).toBe('9007199254740993');
    expect(args[3]).toBe('pending');
    expect(args[4]).toBe('rate_limited');
    expect(args[5]).toBeGreaterThanOrEqual(5);
    query.mockResolvedValueOnce([]);
    expect(await svc.settle(claimed,{outcome:'completed'})).toBe(false);
  });

  it('only cancels scoped jobs, and running cancellation is a request', async () => {
    const {svc,query}=setup();
    query.mockResolvedValueOnce([{id:'15'}]);
    expect(await svc.cancel(guild,'15',actor)).toBe(true);
    expect(query.mock.calls[0][0]).toContain('"cancelRequested"=TRUE');
    expect(query.mock.calls[0][1]).toEqual(['15',guild,actor]);
    await expect(svc.cancel('bad','15',actor)).rejects.toThrow('guild');
    await expect(svc.cancel(guild,'-1',actor)).rejects.toThrow('job ID');
    await expect(svc.cancel(guild,'9223372036854775808',actor))
      .rejects.toThrow('job ID');
  });

  it('manual retry is restricted to definitively non-dispatched dead jobs', async () => {
    const {svc,query}=setup();
    query.mockResolvedValueOnce([{id:'15'}]);
    expect(await svc.retryDead(guild,'15',actor)).toBe(true);
    const sql=query.mock.calls[0][0] as string;
    expect(sql).toContain('"status"=\'dead\'');
    expect(sql).toContain("'retry_exhausted','handler_missing'");
    expect(sql).toContain('"cancelRequested"=FALSE');
    expect(sql).toContain("'manual_retry'");
    expect(sql).not.toContain("'needs_review'");
  });

  it('read-only observability remains guild-scoped and excludes payload content', async () => {
    const {svc,query}=setup();
    query.mockResolvedValueOnce([{status:'dead',count:'2'}]);
    expect(await svc.statusCounts(guild)).toEqual([{status:'dead',count:'2'}]);
    query.mockResolvedValueOnce([]);
    await svc.failedJobs(guild,20);
    const sql=query.mock.calls[1][0] as string;
    expect(sql).toContain('"guildId"=$1');
    expect(sql).not.toContain('SELECT *');
    expect(sql).not.toMatch(/SELECT\s+"payload"/);
    await expect(svc.failedJobs(guild,100)).rejects.toThrow('list');
  });
});
