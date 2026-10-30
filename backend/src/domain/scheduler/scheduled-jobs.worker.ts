import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertClaimedJob, type ClaimedJob, type JobOutcome } from './scheduler-policy';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { ScheduledJobsRegistry } from './scheduled-jobs.registry';

const MAX_IN_FLIGHT_MS = 5 * 60_000;
const SHUTDOWN_GRACE_MS = 5_000;

@Injectable()
export class ScheduledJobsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledJobsWorker.name);
  private readonly workerId = 'yuugen-' + randomUUID();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private activeHeartbeat: ReturnType<typeof setInterval> | null = null;
  private stopping = false;

  constructor(
    private readonly jobs: ScheduledJobsService,
    private readonly registry: ScheduledJobsRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Not enabled by default. Do not run until SQL is migrated on staging.
    if (this.config.get<string>('ENABLE_SCHEDULED_JOB_WORKER') !== 'true') return;
    this.timer = setInterval(() => this.trigger(), 5000);
    this.timer.unref();
    this.trigger();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    // Stop renewing the lease immediately, even if Discord never responds.
    // The reaper will park any unresolved side effect for human review.
    if (this.activeHeartbeat) clearInterval(this.activeHeartbeat);
    if (!this.running) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        this.running,
        new Promise<void>((resolve) => {
          timeout = setTimeout(() => resolve(), SHUTDOWN_GRACE_MS);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /** Never overlap worker ticks in the same process. */
  private trigger(): void {
    if (this.stopping || this.running) return;
    this.running = this.runOnce().catch(() => {
      // No details from DB/Discord errors are sent to logs.
      this.logger.error('Scheduler poll failed; check staging database health');
    }).finally(() => { this.running = null; });
  }

  /** Single-item claim avoids letting other jobs' 60-second leases age in a batch. */
  async runOnce(): Promise<void> {
    // Guard the execution path itself, not just the timer that calls it.
    if (this.stopping || this.config.get<string>('ENABLE_SCHEDULED_JOB_WORKER') !== 'true') return;
    // Recovery is required even if a deployment has not registered handlers:
    // no orphaned running job may remain invisible after restart.
    const uncertain = await this.jobs.reconcileExpiredLeases();
    if (uncertain > 0) {
      this.logger.warn('Scheduler parked expired leases for manual review: ' + uncertain);
    }
    if (this.registry.size === 0) return;
    const [job] = await this.jobs.claim(this.workerId, 1, this.registry.kinds);
    if (job) await this.executeOne(job);
  }

  private async executeOne(job: ClaimedJob): Promise<void> {
    // A JSONB object check is not enough to trust a claimed database payload.
    try {
      assertClaimedJob(job);
    } catch {
      try {
        await this.jobs.settle(job, {
          outcome: 'needs_review', reasonCode: 'invalid_claimed_job',
        });
      } catch {
        // Invalid lease metadata may prevent settlement. Let the reaper park it.
        this.logger.error('Malformed claimed job requires lease reconciliation');
      }
      return;
    }

    let leaseLost = false;
    let timedOut = false;
    const handler = this.registry.get(job.kind);
    const heartbeat = setInterval(() => {
      if (this.stopping || leaseLost) {
        clearInterval(heartbeat);
        return;
      }
      void this.jobs.heartbeat(job).then((alive) => {
        if (!alive) leaseLost = true;
      }).catch(() => { leaseLost = true; });
    }, 15000);
    heartbeat.unref();
    this.activeHeartbeat = heartbeat;
    let deadline: ReturnType<typeof setTimeout> | null = null;

    const assertActive = async (): Promise<void> => {
      if (leaseLost || this.stopping) throw new Error('Scheduler lease stopped');
      const state = await this.jobs.leaseState(job);
      if (!state.alive || state.cancelRequested) {
        throw new Error('Scheduler lease or target canceled');
      }
      if (handler) {
        // A live guild authorization fetch may take time. Check again AFTER
        // it completes; cancel or lease expiry must not be missed in the gap.
        const preflight = await handler.preflight(job);
        if (!preflight || preflight.state !== 'ready') {
          throw new Error('Scheduler live authorization or resource check failed');
        }
      }
      if (leaseLost || this.stopping) throw new Error('Scheduler lease stopped');
      const latest = await this.jobs.leaseState(job);
      if (!latest.alive || latest.cancelRequested || leaseLost || this.stopping) {
        throw new Error('Scheduler lease changed during authorization');
      }
    };

    const dispatch = async (): Promise<JobOutcome | null> => {
      const initial = await this.jobs.leaseState(job);
      if (!initial.alive) return null;
      if (initial.cancelRequested) {
        return { outcome: 'canceled', reasonCode: 'cancel_before_dispatch' };
      }
      if (!handler) return { outcome: 'dead', reasonCode: 'handler_missing' };
      const preflight = await handler.preflight(job);
      if (!preflight) throw new Error('Invalid scheduler preflight');
      if (preflight.state === 'canceled' || preflight.state === 'needs_review') {
        return { outcome: preflight.state, reasonCode: preflight.reasonCode };
      }
      if (preflight.state !== 'ready') throw new Error('Invalid scheduler preflight');
      await assertActive();
      return handler.execute(job, { assertActive });
    };

    try {
      // A nonresponsive provider must not hold the worker or renew its lease
      // forever. Late handler continuations can only pass assertActive while
      // the token is still live; uncertain side effects are never replayed.
      const outcome = await Promise.race([
        dispatch(),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => {
            timedOut = true;
            leaseLost = true;
            reject(new Error('Scheduler execution timed out'));
          }, MAX_IN_FLIGHT_MS);
          deadline.unref();
        }),
      ]);
      if (!outcome || leaseLost) return;
      const settled = await this.jobs.settle(job, outcome);
      if (!settled) this.logger.warn('Scheduler job requires lease reconciliation: ' + job.id);
    } catch {
      // A timeout is uncertain even if the underlying Discord request may
      // still finish. A failed heartbeat also cannot settle a stale token.
      if (!leaseLost || timedOut) {
        try {
          const settled = await this.jobs.settle(job, {
            outcome: 'needs_review',
            reasonCode: timedOut ? 'execution_timeout' : 'unknown_outcome',
          });
          if (!settled) {
            this.logger.warn('Scheduler job requires lease reconciliation: ' + job.id);
          }
        } catch {
          this.logger.error('Scheduler could not park uncertain job: ' + job.id);
        }
      }
    } finally {
      clearInterval(heartbeat);
      if (this.activeHeartbeat === heartbeat) this.activeHeartbeat = null;
      if (deadline) clearTimeout(deadline);
    }
  }
}
