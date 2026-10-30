import { Injectable } from '@nestjs/common';
import { type ClaimedJob, type JobOutcome, type ScheduledKind,
  SCHEDULED_KINDS } from './scheduler-policy';

/**
 * The handler must force-refresh guild membership, bot permissions, role
 * hierarchy, resource cancellation/deletion and the relevant feature toggle.
 * No stale gateway cache may be treated as authorization.
 */
export type JobPreflight =
  | { state: 'ready' }
  | { state: 'canceled' | 'needs_review'; reasonCode: string };

export interface JobExecutionContext {
  /**
   * Checks the database lease AND repeats the handler's live preflight.
   * Call immediately before EACH external side effect. A failure during an
   * already-started handler is treated as uncertain, never as safe-to-retry.
   */
  assertActive(): Promise<void>;
}

export interface ScheduledJobHandler {
  /** Required; handlers lacking an authorization/resource probe are rejected. */
  preflight(job: ClaimedJob): Promise<JobPreflight>;
  /** Return retry ONLY if the handler proves no remote side effect occurred. */
  execute(job: ClaimedJob, context: JobExecutionContext): Promise<JobOutcome>;
}

@Injectable()
export class ScheduledJobsRegistry {
  private readonly handlers = new Map<ScheduledKind, ScheduledJobHandler>();

  register(kind: ScheduledKind, handler: ScheduledJobHandler): void {
    if (!SCHEDULED_KINDS.includes(kind) || !handler ||
        typeof handler.execute !== 'function' ||
        typeof handler.preflight !== 'function') {
      throw new Error('Invalid scheduler handler');
    }
    if (this.handlers.has(kind)) throw new Error('Duplicate job handler: ' + kind);
    this.handlers.set(kind, handler);
  }

  get(kind: ScheduledKind): ScheduledJobHandler | undefined {
    return this.handlers.get(kind);
  }

  get size(): number {
    return this.handlers.size;
  }
}
