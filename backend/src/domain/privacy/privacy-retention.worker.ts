import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RETENTION } from './privacy-policy';
import { PrivacyService } from './privacy.service';

/** Opt-in TTL cleanup; no unrelated guild or moderation data is touched. */
@Injectable()
export class PrivacyRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrivacyRetentionWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly privacy: PrivacyService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('ENABLE_PRIVACY_RETENTION_WORKER') !== 'true') return;
    this.timer = setInterval(
      () => this.trigger(), RETENTION.sweepIntervalMinutes * 60_000,
    );
    this.timer.unref();
    this.trigger();
  }

  private trigger(): void {
    if (this.stopping || this.running) return;
    this.running = this.privacy.pruneExpiredEphemeral()
      .then(({sessions,triviaSessions}) => {
        // Counts only, never user IDs, message contents or session tokens.
        if (sessions || triviaSessions) {
          this.logger.log('Expired ephemeral records pruned: sessions=' +
            sessions + ' trivia=' + triviaSessions);
        }
      })
      .catch(() => this.logger.warn('Privacy retention sweep failed; check database health'))
      .finally(() => {this.running = null;});
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    if (this.running) await this.running;
  }
}
