import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ClaimedJob, type JobOutcome } from './scheduler-policy';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { ScheduledJobsRegistry } from './scheduled-jobs.registry';

@Injectable()
export class ScheduledJobsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledJobsWorker.name);
  private readonly workerId = 'yuugen-' + randomUUID();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
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
    if (this.running) await this.running;
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
    const [job] = await this.jobs.claim(this.workerId, 1);
    if (job) await this.executeOne(job);
  }

  private async executeOne(job: ClaimedJob): Promise<void> {
    let leaseLost = false;
    const handler = this.registry.get(job.kind);
    const heartbeat = setInterval(() => {
      void this.jobs.heartbeat(job).then((alive) => {
        if (!alive) leaseLost = true;
      }).catch(() => { leaseLost = true; });
    }, 15000);
    heartbeat.unref();

    const assertActive = async (): Promise<void> => {
      if (leaseLost || this.stopping) throw new Error('Scheduler lease stopped');
      const state = await this.jobs.leaseState(job);
      if (!state.alive || state.cancelRequested) {
        throw new Error('Scheduler lease or target canceled');
      }
      // Every remote side effect must be preceded by a fresh permission and
      // resource probe, not just a database lease check.
      if (handler) {
        const preflight = await handler.preflight(job);
        if (!preflight || preflight.state !== 'ready') {
          throw new Error('Scheduler live authorization or resource check failed');
        }
      }
    };

    try {
      // Before starting a handler, a canceled job is known to have NO side effect.
      const initial = await this.jobs.leaseState(job);
      if (!initial.alive) return;
      if (initial.cancelRequested) {
        await this.jobs.settle(job, { outcome: 'canceled', reasonCode: 'cancel_before_dispatch' });
        return;
      }

      let outcome: JobOutcome;
      if (!handler) {
        outcome = { outcome: 'dead', reasonCode: 'handler_missing' };
      } else {
        // A pre-dispatch denial is safe to classify before any remote effects.
        // This is mandatory even if the handler forgets to call assertActive.
        const preflight = await handler.preflight(job);
        if (!preflight) throw new Error('Invalid scheduler preflight');
        if (preflight.state === 'canceled' || preflight.state === 'needs_review') {
          outcome = { outcome: preflight.state, reasonCode: preflight.reasonCode };
        } else if (preflight.state === 'ready') {
          // Recheck the lease AND authorization after the first probe: a
          // cancellation could race an async guild permission fetch.
          await assertActive();
          outcome = await handler.execute(job, { assertActive });
        } else {
          throw new Error('Invalid scheduler preflight');
        }
      }
      if (leaseLost) return;
      // An expired or replaced token cannot settle, even after a remote API call.
      const settled = await this.jobs.settle(job, outcome);
      if (!settled) this.logger.warn('Scheduler job requires lease reconciliation: ' + job.id);
    } catch {
      // Unknown provider outcomes must NOT be replayed as transient failures.
      if (!leaseLost) {
        try {
          await this.jobs.settle(job, {
            outcome: 'needs_review', reasonCode: 'unknown_outcome',
          });
        } catch {
          this.logger.error('Scheduler could not park uncertain job: ' + job.id);
        }
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
}
