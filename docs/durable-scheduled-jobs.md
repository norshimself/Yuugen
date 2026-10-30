# Durable scheduled jobs — issue #90

**Implementation stage:** a reusable, opt-in scheduler foundation. It does not
register any Discord action handler and does not send messages, unban users,
end giveaways or create events. All live behavior is disabled by default.
This PR is stacked on migration-runner PR #109 (issue #89); merge and verify
#109 before integrating #90. GitHub Actions remain intentionally disabled.

## New database objects

Apply `backend/migrations/20261030_scheduled_jobs.sql` only after all earlier
migrations in the updated versioned manifest, on a backed-up **staging**
PostgreSQL 17 instance first. The SQL creates:

- `scheduled_jobs`: guild-scoped jobs with a unique
  `(guildId, kind, idempotencyKey)` tuple, minimal typed JSON metadata,
  UTC `timestamptz` due time, attempt bounds, status, lease owner,
  random UUID fencing token, cancellation request and error codes.
- `scheduled_job_events`: metadata-only job lifecycle and operator-action
  journal. This does not store arbitrary exception messages, Discord message
  text, user-provided prompts, credentials or original payload content.

Do not enable TypeORM schema synchronization as a replacement for migration.
The runner must reconcile any manually applied legacy SQL before applying.
Database permissions/backup strategy and restore rehearsals are tracked in #89.

## Job states and behavior

`pending` -> `running` -> `completed` is the normal path. A known
no-side-effect transient failure returns to `pending` with bounded exponential
backoff (up to 15 minutes), or goes to `dead` on exhausted attempts.
A known canceled resource moves to `canceled`. Missing handlers become `dead`
with reason `handler_missing`, without calling Discord.

**Never auto-retry an unknown external outcome.** A thrown handler exception,
lease expiry, lost execution acknowledgement or ambiguous provider call is
`needs_review`. Restarted workers recover pending jobs and retryable known-safe
failures, but expired running jobs are parked for manual investigation. This is
deliberate at-least-once *claim* semantics, NOT exactly-once Discord delivery.
An external API call can succeed just before a worker loses its lease; fencing
prevents stale database settlement but cannot undo the external side effect.

PostgreSQL `clock_timestamp()` defines due time and lease expiry; the API
requires an unambiguous UTC `Z` timestamp and never interprets local DST
values. The worker claims **one job at a time** via row locks with
`FOR UPDATE SKIP LOCKED`, uses a 60-second lease and a 15-second heartbeat.

A cancellation request for a pending job is immediate. A running job may
already have sent an external request; cancel is best-effort. Handlers must
check the cancellation/lease state immediately before each remote mutation.

## Adding a safe handler

A future feature module imports `ScheduledJobsModule` and registers a handler
for one of the four allowed job kinds: `temporary_unban`, `reminder_send`,
`giveaway_close` or `event_notice`. Call the exported
`ScheduledJobsService.enqueue({ guildId, kind, idempotencyKey, payload, runAt })`
with an immutable event key and a minimal ID-only payload.

Every handler **must**:

1. Force-fetch the guild, affected resource and Discord actor/bot permissions
   and hierarchy at execution time; treat a deleted or canceled resource as
   a safe cancellation, not as a reason to dispatch the old action.
2. Call `context.assertActive()` immediately before *each* Discord mutation.
3. Return `{outcome:'retry',reasonCode:'rate_limited'}` only when it can prove
   the remote operation had **no effect**. Use `needs_review` for all unknown
   outcomes, and never interpolate provider exception strings into reason codes.
4. Make irreversible remote effects idempotent or provide a durable external
   reconciliation key. PostgreSQL locking alone is not an exactly-once guarantee.

The current PR provides **no registered handlers**. Merely turning on the
worker flag does not authorize any Discord actions.

## Opt-in activation and observability

`ENABLE_SCHEDULED_JOB_WORKER=false` is the default. Only after the staging
migration, build/tests and a real handler review, set it to `true` on isolated
staging processes. Worker polling never starts otherwise. The internal service
offers guild-scoped `statusCounts` and `failedJobs` views; they intentionally
exclude job payloads. `retryDead` is scoped to a guild and operator ID and
works only for `dead` jobs with `handler_missing` or `retry_exhausted`
(known no-effect classifications). It never retries `needs_review`.

There is **no public HTTP admin endpoint or operator CLI yet**. These methods
are for future permission-checked staff operations. Direct database edits,
deleting lease tokens, changing `needs_review` to `pending`, or running
manual job SQL against live production are **not** supported recovery paths.
Operators must reconcile unknown remote effects before any separate release
adds a controlled reconciliation flow.

## Verification before merge / release

1. Run `cd backend && npm ci && npm run build && npm test -- --runInBand`,
   the e2e suite, the scheduler tests, and the repo's `make verify`. Test
   all four payload kinds and idempotency collisions.
2. On a disposable backed-up PostgreSQL 17 database, apply #109's manifest
   then this additive migration. Verify schema/check constraints/indexes and
   test a rollback and restore into a **new** disposable database.
3. Race two scheduler processes for the same job; prove one claim and one
   completion. Verify duplicate event enqueue after network reconnect,
   cancellation vs claim, fenced settlement with an old UUID and idempotent
   replay after a restart.
4. Kill a worker during an in-flight simulated job. After lease expiration,
   assert `needs_review`, **not** a second outgoing call. Test lease
   heartbeat loss, backpressure, max attempts and manual retry of only a
   definitive no-effect failure.
5. Test UTC timestamps around DST boundaries, database/local clock skew
   and rejected timezone-free schedules.
6. In a disposable Discord guild, *after adding and reviewing a handler*,
   revoke bot permissions, delete the target/channel, disable the feature,
   replay a Discord rate-limit error and simulate an uncertain provider
   response. Require no unapproved action and no second attempt after
   uncertainty. No real user bans/messages should be part of a test.
7. Review metadata retention and deletion with #91, error alerting,
   authenticated operator manual-retry interface and operational metrics.
   Gain operator sign-off before enabling any production worker.

## Rollback

With the worker **disabled**, app code can be rolled back without dispatching
jobs. Do not drop the new tables as an automatic rollback; retain the ledger
and journal for review. Schema rollback requires a separately approved
database restore from a verified backup, with explicit consideration of
post-backup writes. Follow `docs/postgresql-migrations.md` for the base runner.

**Outstanding blockers:** full Nest build/Jest/e2e, real PostgreSQL
multi-worker/lease/crash tests, future permission-aware handlers and
operator-authorized reconciliation/retention. Keep issue #90 open until these
are satisfied. This PR must not be deployed simply because source is merged.
