/**
 * Opt-in REAL PostgreSQL scheduler acceptance tests. These tests create and
 * DROP a uniquely named disposable database on a LOCAL PostgreSQL server.
 *
 * Run only against a local PG 17 instance with CREATEDB permission:
 * YUUGEN_SCHEDULER_TEST_ADMIN_URL=postgres://...@127.0.0.1:5432/postgres \
 * YUUGEN_SCHEDULER_TEST_CONFIRM=disposable \
 *   npm run test:e2e -- --runInBand scheduler.pg.e2e-spec.ts
 *
 * Absent explicit opt-in, this suite is SKIPPED (not claimed as passed).
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { ScheduledJobsService } from '../src/domain/scheduler/scheduled-jobs.service';
import { assertClaimedJob } from '../src/domain/scheduler/scheduler-policy';

const ADMIN_URL = process.env.YUUGEN_SCHEDULER_TEST_ADMIN_URL;
const enabled = Boolean(
  ADMIN_URL && process.env.YUUGEN_SCHEDULER_TEST_CONFIRM === 'disposable',
);
const describeDatabase = enabled ? describe : describe.skip;
const guild = '123456789012345678';
const otherGuild = '234567890123456789';
const moderator = '345678901234567890';
const due = '2026-01-01T00:00:00Z';

describeDatabase('ScheduledJobsService on disposable PostgreSQL 17', () => {
  let admin: DataSource;
  let dbA: DataSource;
  let dbB: DataSource;
  let a: ScheduledJobsService;
  let b: ScheduledJobsService;
  const dbName = 'yuugen_scheduler_it_' + randomBytes(8).toString('hex');
  let created = false;

  beforeAll(async () => {
    if (!ADMIN_URL || process.env.NODE_ENV === 'production') {
      throw new Error('Scheduler integration must never target production');
    }
    const parsed = new URL(ADMIN_URL);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
      throw new Error('Scheduler integration requires an explicit loopback PostgreSQL host');
    }
    // Never mutate the admin database: create an independently named sandbox.
    const target = new URL(ADMIN_URL);
    target.pathname = '/' + dbName;
    target.search = '';

    admin = new DataSource({
      type: 'postgres', url: ADMIN_URL,
      synchronize: false, entities: [],
    });
    await admin.initialize();
    await admin.query('CREATE DATABASE "' + dbName + '"');
    created = true;

    dbA = new DataSource({
      type: 'postgres', url: target.href,
      synchronize: false, entities: [],
    });
    dbB = new DataSource({
      type: 'postgres', url: target.href,
      synchronize: false, entities: [],
    });
    await dbA.initialize();
    await dbB.initialize();

    const migration = await readFile(
      join(__dirname, '../migrations/20261030_scheduled_jobs.sql'),
      'utf8',
    );
    await dbA.query(migration);
    a = new ScheduledJobsService(dbA);
    b = new ScheduledJobsService(dbB);
  }, 45000);

  afterAll(async () => {
    if (dbA?.isInitialized) await dbA.destroy();
    if (dbB?.isInitialized) await dbB.destroy();
    if (admin?.isInitialized) {
      try {
        if (created) {
          await admin.query('DROP DATABASE "' + dbName + '" WITH (FORCE)');
        }
      } finally {
        await admin.destroy();
      }
    }
  }, 30000);

  beforeEach(async () => {
    await dbA.query(
      'TRUNCATE TABLE public.scheduled_job_events, public.scheduled_jobs RESTART IDENTITY CASCADE',
    );
  });

  function reminder(key: string, forGuild = guild, maxAttempts = 5) {
    return {
      guildId: forGuild,
      kind: 'reminder_send' as const,
      idempotencyKey: key,
      payload: { reminderId: 123 },
      runAt: due,
      maxAttempts,
    };
  }

  it('rejects unsupported job kinds and invalid identifiers at the database boundary', async () => {
    const sql =
      'INSERT INTO public.scheduled_jobs ' +
      '("guildId","kind","idempotencyKey","payload","runAt") ' +
      'VALUES ($1,$2,$3,$4::jsonb,clock_timestamp())';
    await expect(dbA.query(sql, [
      guild, 'eval', 'invalid-kind', '{"reminderId":1}',
    ])).rejects.toThrow();
    await expect(dbA.query(sql, [
      'not-a-guild-id', 'reminder_send', 'invalid-guild', '{"reminderId":1}',
    ])).rejects.toThrow();
    await expect(dbA.query(sql, [
      guild, 'reminder_send', 'unexpected key;bad', '{"reminderId":1}',
    ])).rejects.toThrow();
    const rows = await dbA.query('SELECT count(*)::integer AS count FROM public.scheduled_jobs');
    expect(rows[0].count).toBe(0);
  });

  it('inserts once, checks identity on replay and never overwrites the first job', async () => {
    const first = await a.enqueue(reminder('identical'));
    const replay = await b.enqueue(reminder('identical'));
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.id).toBe(first.id);
    await expect(b.enqueue({
      ...reminder('identical'), payload: { reminderId: 456 },
    })).rejects.toThrow('Idempotency key collision');

    const events = await dbA.query(
      'SELECT event FROM public.scheduled_job_events WHERE "jobId"=$1::bigint',
      [first.id],
    );
    expect(events.map((event: { event: string }) => event.event)).toEqual(['queued']);
  });

  it('two workers claim each due job at most once using row locks', async () => {
    for (let i = 0; i < 20; i++) await a.enqueue(reminder('claim:' + i));
    const [first, second] = await Promise.all([a.claim('worker-a', 10), b.claim('worker-b', 10)]);
    const claimed = [...first, ...second];
    expect(claimed).toHaveLength(20);
    expect(new Set(claimed.map((job) => job.id)).size).toBe(20);
    expect(claimed.every((job) => job.attempts === 1 && job.leaseToken)).toBe(true);
    expect(await a.claim('worker-a', 10)).toHaveLength(0);
    const claimEvents = await dbA.query(
      "SELECT count(*)::integer AS count FROM public.scheduled_job_events WHERE event='claimed'",
    );
    expect(claimEvents[0].count).toBe(20);
  });

  it('leaves unregistered job kinds pending until their feature handler is installed', async () => {
    const unban = await a.enqueue({
      guildId: guild, kind: 'temporary_unban', idempotencyKey: 'future-unban',
      payload: { targetUserId: '456789012345678901', moderationCaseId: 9 },
      runAt: due,
    });
    await a.enqueue(reminder('active-reminder'));
    const got = await a.claim('worker-a', 10, ['reminder_send']);
    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe('reminder_send');
    const stillPending = await dbB.query(
      'SELECT "status" FROM public.scheduled_jobs WHERE id=$1::bigint', [unban.id],
    );
    expect(stillPending[0].status).toBe('pending');
    const later = await b.claim('worker-b', 1, ['temporary_unban']);
    expect(later).toHaveLength(1);
    expect(later[0].id).toBe(unban.id);
  });

  it('rejects a corrupted JSONB payload after claim and parks the record', async () => {
    const queued = await a.enqueue(reminder('corrupted-row'));
    // PostgreSQL validates JSONB object structure, not kind-specific fields.
    await dbA.query(
      'UPDATE public.scheduled_jobs SET "payload"=$2::jsonb WHERE id=$1::bigint',
      [queued.id, '{"reminderId":123,"messageContent":"@everyone"}'],
    );
    const [claimed] = await a.claim('worker-a', 1, ['reminder_send']);
    expect(() => assertClaimedJob(claimed)).toThrow('payload');
    expect(await a.settle(claimed, {
      outcome: 'needs_review', reasonCode: 'invalid_claimed_job',
    })).toBe(true);
    expect(await b.claim('worker-b', 1, ['reminder_send'])).toHaveLength(0);
    const status = await dbB.query(
      'SELECT "status" FROM public.scheduled_jobs WHERE id=$1::bigint',
      [queued.id],
    );
    expect(status[0].status).toBe('needs_review');
  });

  it('uses database time, not the application clock, to release due jobs', async () => {
    const future = await a.enqueue({
      ...reminder('future'), runAt: '2099-12-31T00:00:00Z',
    });
    expect(await a.claim('worker-a', 1)).toHaveLength(0);
    await dbA.query(
      'UPDATE public.scheduled_jobs SET "runAt"=clock_timestamp()-INTERVAL \'1 second\' WHERE id=$1::bigint',
      [future.id],
    );
    expect((await a.claim('worker-a', 1))[0].id).toBe(future.id);
  });

  it('releases an unstarted claim without losing the job or consuming attempts',async()=>{
    const queued=await a.enqueue(reminder('shutdown-before-dispatch'));
    const [first]=await a.claim('worker-a',1,['reminder_send']);
    expect(first.attempts).toBe(1);
    expect(await b.releaseUnstarted(first)).toBe(true);
    const rows=await dbB.query(
      'SELECT "status","attempts","leaseToken" IS NULL AS "unowned" '+
      'FROM public.scheduled_jobs WHERE id=$1::bigint',[queued.id],
    );
    expect(rows[0]).toEqual({status:'pending',attempts:0,unowned:true});
    const [second]=await b.claim('worker-b',1,['reminder_send']);
    expect(second.id).toBe(queued.id);
    expect(second.attempts).toBe(1);
    expect(await a.releaseUnstarted(first)).toBe(false);
    const events=await dbB.query(
      'SELECT "event","attempt" FROM public.scheduled_job_events '+
      'WHERE "jobId"=$1::bigint ORDER BY id',[queued.id],
    );
    expect(events).toEqual([
      {event:'queued',attempt:0},
      {event:'claimed',attempt:1},
      {event:'released_unstarted',attempt:0},
      {event:'claimed',attempt:1},
    ]);
  });

  it('raced manager cancellation stays terminal on an unstarted release',async()=>{
    const queued=await a.enqueue(reminder('shutdown-cancel-race'));
    const [first]=await a.claim('worker-a',1,['reminder_send']);
    expect(await b.cancel(guild,queued.id,moderator)).toBe(true);
    expect(await a.releaseUnstarted(first)).toBe(true);
    const rows=await dbB.query(
      'SELECT "status","attempts","cancelRequested","lastErrorCode" '+
      'FROM public.scheduled_jobs WHERE id=$1::bigint',[queued.id],
    );
    expect(rows[0]).toEqual({
      status:'canceled',attempts:0,cancelRequested:true,
      lastErrorCode:'cancel_requested',
    });
    expect(await a.claim('worker-b',1,['reminder_send'])).toHaveLength(0);
  });

  it('stale release after lease expiry never resurrects uncertain work',async()=>{
    const queued=await a.enqueue(reminder('shutdown-expired'));
    const [first]=await a.claim('worker-a',1,['reminder_send']);
    await dbB.query(
      'UPDATE public.scheduled_jobs SET "leaseUntil"=clock_timestamp()-INTERVAL \'1 second\' '+
      'WHERE id=$1::bigint',[queued.id],
    );
    expect(await a.releaseUnstarted(first)).toBe(false);
    expect(await b.reconcileExpiredLeases()).toBe(1);
    expect(await a.releaseUnstarted(first)).toBe(false);
    expect(await b.claim('worker-b',1,['reminder_send'])).toHaveLength(0);
    const rows=await dbB.query(
      'SELECT "status" FROM public.scheduled_jobs WHERE id=$1::bigint',[queued.id],
    );
    expect(rows[0].status).toBe('needs_review');
  });

  it('parks a crashed/expired worker as needs_review, never double-dispatches', async () => {
    const queued = await a.enqueue(reminder('crash'));
    const [claimed] = await a.claim('worker-a', 1);
    expect(claimed.id).toBe(queued.id);
    // Simulate a crash / elapsed lease without waiting 60 seconds.
    await dbA.query(
      'UPDATE public.scheduled_jobs SET "leaseUntil"=clock_timestamp()-INTERVAL \'1 second\' WHERE id=$1::bigint',
      [queued.id],
    );
    expect(await b.reconcileExpiredLeases()).toBe(1);
    expect(await a.reconcileExpiredLeases()).toBe(0);
    expect(await b.claim('worker-b', 1)).toHaveLength(0);
    expect(await a.settle(claimed, { outcome: 'completed' })).toBe(false);
    const rows = await dbB.query(
      'SELECT "status","lastErrorCode" FROM public.scheduled_jobs WHERE id=$1::bigint',
      [queued.id],
    );
    expect(rows[0]).toEqual(expect.objectContaining({
      status: 'needs_review', lastErrorCode: 'lease_expired',
    }));
    expect(await a.retryDead(guild, queued.id, moderator)).toBe(false);
  });

  it('cancellation racing a retry cannot leave an unclaimable pending job', async () => {
    const queued = await a.enqueue(reminder('cancel-race', guild, 1));
    const [claimed] = await a.claim('worker-a', 1);
    expect(await b.cancel(guild, queued.id, moderator)).toBe(true);
    expect(await a.settle(claimed, {
      outcome: 'retry', reasonCode: 'rate_limited',
    })).toBe(true);
    const rows = await dbB.query(
      'SELECT "status","cancelRequested" FROM public.scheduled_jobs WHERE id=$1::bigint',
      [queued.id],
    );
    expect(rows[0].status).toBe('canceled');
    expect(rows[0].cancelRequested).toBe(true);
    expect(await b.claim('worker-b', 1)).toHaveLength(0);
    expect(await b.retryDead(guild, queued.id, moderator)).toBe(false);
  });

  it('retries only proven no-effect dead jobs and respects guild scope', async () => {
    const queued = await a.enqueue(reminder('dead'));
    const [claimed] = await a.claim('worker-a', 1);
    expect(await a.settle(claimed, {
      outcome: 'dead', reasonCode: 'handler_missing',
    })).toBe(true);
    expect(await b.retryDead(otherGuild, queued.id, moderator)).toBe(false);
    expect(await b.retryDead(guild, queued.id, moderator)).toBe(true);
    expect(await b.retryDead(guild, queued.id, moderator)).toBe(false);
    const [second] = await a.claim('worker-a', 1);
    expect(second.id).toBe(queued.id);
    expect(second.attempts).toBe(1);
    expect(await a.statusCounts(otherGuild)).toEqual([]);
  });

  it('manual verification only resolves needs_review terminally and once per guild',async()=>{
    const queued=await a.enqueue(reminder('manual-review'));
    const [claimed]=await a.claim('worker-a',1);
    expect(await a.settle(claimed,{
      outcome:'needs_review',reasonCode:'unknown_outcome',
    })).toBe(true);
    expect(await b.resolveReviewedJob(otherGuild,queued.id,moderator,'completed')).toBe(false);
    expect(await b.resolveReviewedJob(guild,queued.id,moderator,'completed')).toBe(true);
    expect(await b.resolveReviewedJob(guild,queued.id,moderator,'canceled')).toBe(false);
    expect(await a.retryDead(guild,queued.id,moderator)).toBe(false);
    expect(await b.claim('worker-b',1,['reminder_send'])).toHaveLength(0);
    const jobRows=await dbB.query(
      'SELECT "status","lastErrorCode" FROM public.scheduled_jobs WHERE id=$1::bigint',
      [queued.id],
    );
    expect(jobRows[0]).toEqual({
      status:'completed',lastErrorCode:'unknown_outcome',
    });
    const audit=await dbA.query(
      'SELECT "event","actorId","reasonCode" FROM public.scheduled_job_events '+
      'WHERE "jobId"=$1::bigint AND "event"=$2',
      [queued.id,'manual_resolved'],
    );
    expect(audit).toEqual([{
      event:'manual_resolved',actorId:moderator,
      reasonCode:'operator_verified_complete',
    }]);
    const canceled=await a.enqueue(reminder('manual-review-absent'));
    const [second]=await a.claim('worker-a',1);
    expect(second.id).toBe(canceled.id);
    expect(await a.settle(second,{
      outcome:'needs_review',reasonCode:'unknown_outcome',
    })).toBe(true);
    expect(await b.resolveReviewedJob(guild,canceled.id,moderator,'canceled')).toBe(true);
    const resolution=await dbB.query(
      'SELECT "status" FROM public.scheduled_jobs WHERE id=$1::bigint',
      [canceled.id],
    );
    expect(resolution[0].status).toBe('canceled');
  });

  it('health metrics separate due runnable jobs from disabled feature kinds',async()=>{
    const running=await a.enqueue(reminder('metrics-running'));
    const [inFlight]=await a.claim('worker-a',1);
    expect(inFlight.id).toBe(running.id);
    await dbA.query(
      'UPDATE public.scheduled_jobs SET "leaseUntil"=clock_timestamp()-INTERVAL \'1 second\' '+
      'WHERE id=$1::bigint',[running.id],
    );
    await a.enqueue(reminder('metrics-review'));
    const [review]=await a.claim('worker-a',1);
    expect(await a.settle(review,{
      outcome:'needs_review',reasonCode:'unknown_outcome',
    })).toBe(true);
    await a.enqueue(reminder('metrics-dead'));
    const [dead]=await a.claim('worker-a',1);
    expect(await a.settle(dead,{
      outcome:'dead',reasonCode:'handler_missing',
    })).toBe(true);
    await a.enqueue({
      guildId:guild,kind:'event_notice',idempotencyKey:'metrics-disabled',
      payload:{eventId:19},runAt:due,
    });
    await a.enqueue(reminder('metrics-runnable'));
    const metrics=await a.healthMetrics(guild,['reminder_send']);
    expect(metrics).toEqual(expect.objectContaining({
      dueRunnable:'1',awaitingHandler:'1',expiredLeases:'1',
      needsReview:'1',dead:'1',
    }));
    expect(Number(metrics.oldestDueSeconds)).toBeGreaterThan(0);
    const disabled=await b.healthMetrics(guild,[]);
    expect(disabled.dueRunnable).toBe('0');
    expect(disabled.awaitingHandler).toBe('2');
    expect(disabled.oldestDueSeconds).toBe('0');
    const other=await b.healthMetrics(otherGuild,['reminder_send']);
    expect(other.dueRunnable).toBe('0');
    expect(other.needsReview).toBe('0');
    expect(other.dead).toBe('0');
  });

  it('pending cancellation is final, fenced and auditable', async () => {
    const queued = await a.enqueue(reminder('pending-cancel'));
    expect(await b.cancel(guild, queued.id, moderator)).toBe(true);
    expect(await a.claim('worker-a', 1)).toHaveLength(0);
    const events = await dbA.query(
      'SELECT event,"actorId" FROM public.scheduled_job_events WHERE "jobId"=$1::bigint ORDER BY id',
      [queued.id],
    );
    expect(events).toEqual([
      { event: 'queued', actorId: null },
      { event: 'canceled', actorId: moderator },
    ]);
  });
});
