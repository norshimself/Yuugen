-- Durable, opt-in scheduler foundation; apply only after #89 migration runner.
-- No jobs are created by this DDL. No Discord action or deployment is implied.
BEGIN;

CREATE TABLE IF NOT EXISTS "scheduled_jobs" (
  "id" BIGSERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "kind" VARCHAR(48) NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "payload" JSONB NOT NULL,
  "runAt" TIMESTAMPTZ NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "leaseToken" UUID NULL,
  "leaseOwner" VARCHAR(80) NULL,
  "leaseUntil" TIMESTAMPTZ NULL,
  "cancelRequested" BOOLEAN NOT NULL DEFAULT FALSE,
  "lastErrorCode" VARCHAR(64) NULL,
  "lastErrorAt" TIMESTAMPTZ NULL,
  "finishedAt" TIMESTAMPTZ NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UQ_scheduled_jobs_guild_kind_idempotency" UNIQUE ("guildId", "kind", "idempotencyKey"),
  CONSTRAINT "CHK_scheduled_jobs_status" CHECK ("status" IN (
    'pending', 'running', 'completed', 'canceled', 'dead', 'needs_review'
  )),
  CONSTRAINT "CHK_scheduled_jobs_attempts" CHECK (
    "attempts" BETWEEN 0 AND "maxAttempts" AND "maxAttempts" BETWEEN 1 AND 10
  ),
  CONSTRAINT "CHK_scheduled_jobs_payload" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "CHK_scheduled_jobs_lease" CHECK (
    ("status" = 'running' AND "leaseToken" IS NOT NULL
      AND "leaseOwner" IS NOT NULL AND "leaseUntil" IS NOT NULL)
    OR ("status" <> 'running' AND "leaseToken" IS NULL
      AND "leaseOwner" IS NULL AND "leaseUntil" IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS "IDX_scheduled_jobs_pending"
  ON "scheduled_jobs" ("runAt", "id") WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "IDX_scheduled_jobs_lease_expiry"
  ON "scheduled_jobs" ("leaseUntil", "id") WHERE "status" = 'running';

CREATE INDEX IF NOT EXISTS "IDX_scheduled_jobs_guild_status"
  ON "scheduled_jobs" ("guildId", "status", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "scheduled_job_events" (
  "id" BIGSERIAL PRIMARY KEY,
  "jobId" BIGINT NOT NULL REFERENCES "scheduled_jobs" ("id") ON DELETE CASCADE,
  "event" VARCHAR(24) NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "actorId" VARCHAR(20) NULL,
  "reasonCode" VARCHAR(64) NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_scheduled_job_events_event" CHECK (
    "event" IN ('queued', 'claimed', 'completed', 'canceled', 'retry',
      'dead', 'needs_review', 'lease_expired', 'manual_retry', 'cancel_requested')
  ),
  CONSTRAINT "CHK_scheduled_job_events_attempt" CHECK ("attempt" BETWEEN 0 AND 10)
);

CREATE INDEX IF NOT EXISTS "IDX_scheduled_job_events_job_created"
  ON "scheduled_job_events" ("jobId", "createdAt" DESC);

COMMIT;
