import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { type ClaimedJob, type JobOutcome, type NewScheduledJob,
  normalizeJob, transitionFor, assertSnowflake } from './scheduler-policy';

const JOBS = 'public.scheduled_jobs';
const EVENTS = 'public.scheduled_job_events';

function assertJobId(id: string): void {
  if (typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id) ||
      BigInt(id) > 9223372036854775807n) {
    throw new Error('Invalid job ID');
  }
}

@Injectable()
export class ScheduledJobsService {
  constructor(private readonly db: DataSource) {}

  /** A duplicate key must match the original action exactly. */
  async enqueue(input: NewScheduledJob): Promise<{ id: string; status: string; created: boolean }> {
    const j = normalizeJob(input);
    const args = [j.guildId, j.kind, j.idempotencyKey,
      JSON.stringify(j.payload), j.runAt, j.maxAttempts];
    const rows: Array<{id: string; status: string}> = await this.db.query(
      `WITH inserted AS (
        INSERT INTO ${JOBS} ("guildId","kind","idempotencyKey","payload","runAt","maxAttempts")
        VALUES ($1,$2,$3,$4::jsonb,$5::timestamptz,$6)
        ON CONFLICT ("guildId","kind","idempotencyKey") DO NOTHING
        RETURNING id,"status"
      ), audit AS (
        INSERT INTO ${EVENTS} ("jobId","event") SELECT id,'queued' FROM inserted
      ) SELECT id::text AS id,"status" FROM inserted`, args);
    if (rows.length) return {...rows[0],created:true};
    const previous: Array<{id:string;status:string;identical:boolean}> = await this.db.query(
      `SELECT id::text AS id,"status",
        ("payload"=$4::jsonb AND "runAt"=$5::timestamptz
         AND "maxAttempts"=$6) AS identical
        FROM ${JOBS} WHERE "guildId"=$1 AND "kind"=$2 AND "idempotencyKey"=$3`,args);
    if (previous.length !== 1 || !previous[0].identical) {
      throw new Error('Idempotency key collision or concurrent deletion');
    }
    return {id:previous[0].id,status:previous[0].status,created:false};
  }

  /** Pending claims use PostgreSQL time and SKIP LOCKED, across all processes. */
  async claim(workerId: string, limit = 5): Promise<ClaimedJob[]> {
    if (!/^[a-zA-Z0-9:_-]{1,80}$/.test(workerId)) throw new Error('Invalid worker ID');
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Invalid batch size');
    return this.db.query(
      `WITH due AS (
        SELECT id FROM ${JOBS}
        WHERE "status"='pending' AND "runAt" <= clock_timestamp()
          AND "cancelRequested"=FALSE AND "attempts" < "maxAttempts"
        ORDER BY "runAt",id LIMIT $1 FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE ${JOBS} AS j SET "status"='running',"attempts"=j."attempts"+1,
          "leaseToken"=gen_random_uuid(),"leaseOwner"=$2,
          "leaseUntil"=clock_timestamp()+INTERVAL '60 seconds',
          "updatedAt"=clock_timestamp()
        FROM due WHERE j.id=due.id RETURNING j.*
      ), audit AS (
        INSERT INTO ${EVENTS} ("jobId","event","attempt")
        SELECT id,'claimed',"attempts" FROM claimed
      ) SELECT id::text AS id,"guildId","kind","payload","attempts","maxAttempts",
        "leaseToken"::text AS "leaseToken","leaseOwner","cancelRequested"
        FROM claimed`,[limit,workerId]);
  }

  /** An expired in-flight external operation is UNCERTAIN, not auto-retryable. */
  async reconcileExpiredLeases(): Promise<number> {
    const rows: Array<{jobId:string}> = await this.db.query(
      `WITH due AS (
        SELECT id FROM ${JOBS}
        WHERE "status"='running' AND "leaseUntil"<=clock_timestamp()
        ORDER BY "leaseUntil",id LIMIT 100 FOR UPDATE SKIP LOCKED
      ), expired AS (
        UPDATE ${JOBS} AS j SET "status"='needs_review',"leaseToken"=NULL,
          "leaseOwner"=NULL,"leaseUntil"=NULL,"lastErrorCode"='lease_expired',
          "lastErrorAt"=clock_timestamp(),"finishedAt"=clock_timestamp(),
          "updatedAt"=clock_timestamp()
        FROM due WHERE j.id=due.id
        RETURNING j.id,j."attempts"
      ) INSERT INTO ${EVENTS} ("jobId","event","attempt","reasonCode")
        SELECT id,'lease_expired',"attempts",'lease_expired' FROM expired
        RETURNING "jobId"::text AS "jobId"`);
    return rows.length;
  }

  async leaseState(job: ClaimedJob): Promise<{alive:boolean;cancelRequested:boolean}> {
    const rows: Array<{cancelRequested:boolean}> = await this.db.query(
      `SELECT "cancelRequested" FROM ${JOBS}
        WHERE id=$1::bigint AND "status"='running'
          AND "leaseToken"=$2::uuid AND "leaseOwner"=$3
          AND "leaseUntil">clock_timestamp()`,
      [job.id,job.leaseToken,job.leaseOwner]);
    return rows.length
      ? {alive:true,cancelRequested:rows[0].cancelRequested}
      : {alive:false,cancelRequested:false};
  }

  async heartbeat(job: ClaimedJob): Promise<boolean> {
    const rows: Array<{id:string}> = await this.db.query(
      `UPDATE ${JOBS} SET "leaseUntil"=clock_timestamp()+INTERVAL '60 seconds',
         "updatedAt"=clock_timestamp()
        WHERE id=$1::bigint AND "status"='running'
          AND "leaseToken"=$2::uuid AND "leaseOwner"=$3
          AND "leaseUntil">clock_timestamp() RETURNING id::text AS id`,
      [job.id,job.leaseToken,job.leaseOwner]);
    return rows.length===1;
  }

  /** Stale tokens cannot settle. Retry outcomes certify NO remote side effect. */
  async settle(job: ClaimedJob, outcome: JobOutcome): Promise<boolean> {
    const t = transitionFor(job.id,job.attempts,job.maxAttempts,outcome);
    const rows: Array<{id:string}> = await this.db.query(
      `WITH settled AS (
        UPDATE ${JOBS} SET
          "status"=CASE WHEN "cancelRequested" AND $4='pending'
            THEN 'canceled' ELSE $4 END,
          "runAt"=CASE WHEN $4='pending' AND NOT "cancelRequested"
            THEN clock_timestamp()+($6::integer * INTERVAL '1 second')
            ELSE "runAt" END,
          "leaseToken"=NULL,"leaseOwner"=NULL,"leaseUntil"=NULL,
          "lastErrorCode"=CASE WHEN "cancelRequested" AND $4='pending'
            THEN 'cancel_requested' ELSE $5 END,
          "lastErrorAt"=CASE WHEN $5::text IS NULL THEN NULL ELSE clock_timestamp() END,
          "finishedAt"=CASE WHEN $4='pending' AND NOT "cancelRequested"
            THEN NULL ELSE clock_timestamp() END,
          "updatedAt"=clock_timestamp()
        WHERE id=$1::bigint AND "status"='running'
          AND "leaseToken"=$2::uuid AND "leaseOwner"=$3
          AND "leaseUntil">clock_timestamp()
        RETURNING id,"attempts","status","lastErrorCode"
      ), audit AS (
        INSERT INTO ${EVENTS} ("jobId","event","attempt","reasonCode")
        SELECT id,CASE WHEN "status"='pending' THEN 'retry' ELSE "status" END,
          "attempts","lastErrorCode" FROM settled
      ) SELECT id::text AS id FROM settled`,
      [job.id,job.leaseToken,job.leaseOwner,t.status,t.reasonCode,t.retryDelaySeconds]);
    return rows.length===1;
  }

  /** A pending cancellation is final; a running cancellation is best-effort. */
  async cancel(guildId: string, id: string, actorId: string): Promise<boolean> {
    assertSnowflake(guildId,'guild ID');
    assertSnowflake(actorId,'operator ID');
    assertJobId(id);
    const rows: Array<{id:string}> = await this.db.query(
      `WITH changed AS (
        UPDATE ${JOBS} SET
          "status"=CASE WHEN "status"='pending' THEN 'canceled' ELSE "status" END,
          "cancelRequested"=TRUE,
          "finishedAt"=CASE WHEN "status"='pending' THEN clock_timestamp()
            ELSE "finishedAt" END,
          "updatedAt"=clock_timestamp()
        WHERE id=$1::bigint AND "guildId"=$2
          AND "status" IN ('pending','running') AND "cancelRequested"=FALSE
        RETURNING id,"status","attempts"
      ), audit AS (
        INSERT INTO ${EVENTS} ("jobId","event","attempt","actorId")
        SELECT id,CASE WHEN "status"='canceled' THEN 'canceled'
          ELSE 'cancel_requested' END,"attempts",$3 FROM changed
      ) SELECT id::text AS id FROM changed`,[id,guildId,actorId]);
    return rows.length===1;
  }

  /** Manual retries cannot replay uncertain Discord side effects. */
  async retryDead(guildId: string, id: string, actorId: string): Promise<boolean> {
    assertSnowflake(guildId,'guild ID');
    assertSnowflake(actorId,'operator ID');
    assertJobId(id);
    const rows: Array<{id:string}> = await this.db.query(
      `WITH changed AS (
        UPDATE ${JOBS} SET "status"='pending',"attempts"=0,
          "runAt"=clock_timestamp(),"finishedAt"=NULL,
          "lastErrorCode"=NULL,"lastErrorAt"=NULL,
          "cancelRequested"=FALSE,"updatedAt"=clock_timestamp()
        WHERE id=$1::bigint AND "guildId"=$2 AND "status"='dead'
          AND "lastErrorCode" IN ('retry_exhausted','handler_missing')
        RETURNING id,"attempts"
      ), audit AS (
        INSERT INTO ${EVENTS} ("jobId","event","attempt","actorId")
        SELECT id,'manual_retry',"attempts",$3 FROM changed
      ) SELECT id::text AS id FROM changed`,[id,guildId,actorId]);
    return rows.length===1;
  }

  /** Internal-only status: no payload or idempotency key is returned. */
  async statusCounts(guildId: string): Promise<Array<{status:string;count:string}>> {
    assertSnowflake(guildId,'guild ID');
    return this.db.query(
      `SELECT "status",count(*)::text AS count FROM ${JOBS}
        WHERE "guildId"=$1 GROUP BY "status" ORDER BY "status"`,[guildId]);
  }

  async failedJobs(guildId: string, limit = 20): Promise<Array<{
    id:string;kind:string;status:string;attempts:number;lastErrorCode:string|null;
  }>> {
    assertSnowflake(guildId,'guild ID');
    if (!Number.isInteger(limit) || limit<1 || limit>50) throw new Error('Invalid list size');
    return this.db.query(
      `SELECT id::text AS id,"kind","status","attempts","lastErrorCode"
        FROM ${JOBS} WHERE "guildId"=$1 AND "status" IN ('dead','needs_review')
        ORDER BY "updatedAt" DESC,id DESC LIMIT $2`,[guildId,limit]);
  }
}
