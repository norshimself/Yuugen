import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, LessThan, Repository } from 'typeorm';
import {
  DEFAULT_ANTI_NUKE_CONFIG, isAntiNukeExempt, isRecentAuditEvent,
  validateAntiNukeConfig, type AntiNukeConfig, type AntiNukeKind,
} from './anti-nuke-policy';
import { AntiNukeSettings } from './anti-nuke-settings.entity';
import { AntiNukeEvent } from './anti-nuke-event.entity';
import { AntiNukeAlert } from './anti-nuke-alert.entity';

const SNOWFLAKE = /^\d{17,20}$/;
const ALERT_BUCKET_MS = 5 * 60_000;
const EVENT_RETENTION_MS = 60 * 60_000;
const ALERT_RETENTION_MS = 30 * 24 * 60 * 60_000;

function validId(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE.test(value);
}
function checkGuild(guildId: unknown): asserts guildId is string {
  if (!validId(guildId)) throw new BadRequestException('Invalid guild ID');
}

export interface AntiNukeObservation {
  guildId: string;
  auditEntryId: string;
  kind: AntiNukeKind;
  actorId: string | null;
  targetId: string | null;
  eventAtMs: number;
  observedAtMs: number;
}

export interface AntiNukeDispatch {
  guildId: string;
  alertId: number;
  alertChannelId: string;
  eventCount: number;
  windowSeconds: number;
  triggeredBy: AntiNukeKind;
}

@Injectable()
export class AntiNukeService {
  private readonly configCache = new Map<string, { value: AntiNukeConfig; expires: number }>();
  private readonly lastPruned = new Map<string, number>();

  constructor(
    @InjectRepository(AntiNukeSettings)
    private readonly settings: Repository<AntiNukeSettings>,
    @InjectRepository(AntiNukeEvent)
    private readonly events: Repository<AntiNukeEvent>,
    @InjectRepository(AntiNukeAlert)
    private readonly alerts: Repository<AntiNukeAlert>,
  ) {}

  async getConfig(guildId: string): Promise<AntiNukeConfig> {
    checkGuild(guildId);
    const cached = this.configCache.get(guildId);
    if (cached && cached.expires > Date.now()) {
      return { ...cached.value, exemptActorIds: [...cached.value.exemptActorIds] };
    }
    const row = await this.settings.findOne({ where: { guildId } });
    const value: AntiNukeConfig = row
      ? {
          enabled: row.enabled,
          mode: row.mode,
          threshold: row.threshold,
          windowSeconds: row.windowSeconds,
          alertChannelId: row.alertChannelId,
          exemptActorIds: [...row.exemptActorIds],
        }
      : { ...DEFAULT_ANTI_NUKE_CONFIG, exemptActorIds: [] };
    if (this.configCache.size >= 500) this.configCache.clear();
    this.configCache.set(guildId, { value, expires: Date.now() + 5000 });
    return { ...value, exemptActorIds: [...value.exemptActorIds] };
  }

  async setConfig(guildId: string, input: unknown): Promise<AntiNukeConfig> {
    checkGuild(guildId);
    const error = validateAntiNukeConfig(input);
    if (error) throw new BadRequestException(error);
    const value = input as AntiNukeConfig;
    const settings: AntiNukeConfig = {
      enabled: value.enabled,
      mode: 'alert_only',
      threshold: value.threshold,
      windowSeconds: value.windowSeconds,
      alertChannelId: value.alertChannelId,
      exemptActorIds: [...new Set(value.exemptActorIds)],
    };
    await this.settings.save(this.settings.create({ guildId, ...settings }));
    this.configCache.delete(guildId);
    return settings;
  }

  async recentAlerts(guildId: string): Promise<AntiNukeAlert[]> {
    checkGuild(guildId);
    return this.alerts.find({
      where: { guildId }, order: { createdAt: 'DESC', id: 'DESC' }, take: 20,
    });
  }

  /**
   * Deduplicate by Discord's *actual* audit-log entry ID, never an inferred
   * gateway correlation. A reserved alert is persisted before sending.
   */
  async observe(input: AntiNukeObservation): Promise<AntiNukeDispatch | null> {
    checkGuild(input?.guildId);
    if (!validId(input.auditEntryId) || ![
      'channel_delete', 'role_delete', 'webhook_delete', 'permission_escalation',
    ].includes(input.kind) || !isRecentAuditEvent(input.eventAtMs, input.observedAtMs)) {
      return null;
    }
    const config = await this.getConfig(input.guildId);
    if (!config.enabled || config.mode !== 'alert_only' ||
        !config.alertChannelId ||
        isAntiNukeExempt(config, validId(input.actorId) ? input.actorId : null)) {
      return null;
    }
    await this.pruneOld(input.guildId, input.observedAtMs);
    const insertion = await this.events.createQueryBuilder()
      .insert().into(AntiNukeEvent)
      .values({
        guildId: input.guildId,
        auditEntryId: input.auditEntryId,
        kind: input.kind,
        actorId: validId(input.actorId) ? input.actorId : null,
        targetId: validId(input.targetId) ? input.targetId : null,
        eventAt: new Date(input.eventAtMs),
      })
      .orIgnore().returning('*').execute();
    if (!insertion.raw?.length) return null; // Reconnect/replay or concurrent worker.

    const eventCount = await this.events.count({
      where: {
        guildId: input.guildId,
        eventAt: Between(
          new Date(input.observedAtMs - config.windowSeconds * 1000),
          new Date(input.observedAtMs + 2000),
        ),
      },
    });
    if (eventCount < config.threshold) return null;

    // The partial result must be an actual INSERT, not an existing row.
    // The bucket uniqueness index handles concurrent workers and bursts.
    const bucketStart = new Date(
      Math.floor(input.observedAtMs / ALERT_BUCKET_MS) * ALERT_BUCKET_MS,
    );
    const reserved = await this.alerts.createQueryBuilder()
      .insert().into(AntiNukeAlert)
      .values({
        guildId: input.guildId, bucketStart, eventCount,
        windowSeconds: config.windowSeconds, triggeredBy: input.kind,
        status: 'pending', deliveredAt: null, failureReason: null,
        reviewedAt: null, reviewedById: null, disposition: null,
      }).orIgnore().returning('*').execute();
    const row: AntiNukeAlert | undefined = reserved.raw?.[0];
    if (!row) return null;
    return {
      guildId: input.guildId,
      alertId: row.id,
      alertChannelId: config.alertChannelId,
      eventCount,
      windowSeconds: config.windowSeconds,
      triggeredBy: input.kind,
    };
  }

  /** Never retry an ambiguous Discord send; leave pending for review. */
  async finishAlert(
    guildId: string,
    alertId: number,
    result: 'sent' | 'missing_permissions',
  ): Promise<boolean> {
    checkGuild(guildId);
    if (!Number.isSafeInteger(alertId) || alertId < 1 ||
        !['sent', 'missing_permissions'].includes(result)) {
      throw new BadRequestException('Invalid alert completion');
    }
    const changed = await this.alerts.update(
      { guildId, id: alertId, status: 'pending' },
      result === 'sent'
        ? { status: 'sent', deliveredAt: new Date(), failureReason: null }
        : { status: 'failed', failureReason: 'missing_permissions' },
    );
    return (changed.affected || 0) > 0;
  }

  /** Manual, single-use staff disposition. Does not change guild state. */
  async reviewAlert(
    guildId: string,
    alertId: number,
    reviewerId: string,
    disposition: 'legitimate' | 'suspicious',
  ): Promise<boolean> {
    checkGuild(guildId);
    if (!validId(reviewerId) || !Number.isSafeInteger(alertId) ||
        alertId < 1 || !['legitimate', 'suspicious'].includes(disposition)) {
      throw new BadRequestException('Invalid alert review');
    }
    const updated = await this.alerts.update(
      { guildId, id: alertId, reviewedAt: IsNull() },
      { reviewedById: reviewerId, reviewedAt: new Date(), disposition },
    );
    return (updated.affected || 0) > 0;
  }

  /** Opportunistic cleanup; quiet-guild scheduled retention is deferred. */
  private async pruneOld(guildId: string, now: number): Promise<void> {
    if (now - (this.lastPruned.get(guildId) || 0) < ALERT_BUCKET_MS) return;
    await this.events.delete({
      guildId, eventAt: LessThan(new Date(now - EVENT_RETENTION_MS)),
    });
    await this.alerts.delete({
      guildId, createdAt: LessThan(new Date(now - ALERT_RETENTION_MS)),
    });
    if (this.lastPruned.size >= 500) this.lastPruned.clear();
    this.lastPruned.set(guildId, now);
  }
}
