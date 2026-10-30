import { Injectable } from '@nestjs/common';
import { type ClaimedJob, type JobOutcome, type ScheduledKind,
  SCHEDULED_KINDS } from './scheduler-policy';

export interface JobExecutionContext {
  /**
   * Must be called immediately before EACH external side effect. The handler
   * must additionally re-fetch the guild, bot permission, target and resource.
   */
  assertActive(): Promise<void>;
}

export interface ScheduledJobHandler {
  /** Return retry ONLY if the handler proves no remote side effect occurred. */
  execute(job: ClaimedJob, context: JobExecutionContext): Promise<JobOutcome>;
}

@Injectable()
export class ScheduledJobsRegistry {
  private readonly handlers = new Map<ScheduledKind, ScheduledJobHandler>();

  register(kind: ScheduledKind, handler: ScheduledJobHandler): void {
    if (!SCHEDULED_KINDS.includes(kind) || !handler ||
        typeof handler.execute !== 'function') {
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
