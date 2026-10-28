import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThan, Repository } from 'typeorm';
import {
  DEFAULT_ANTI_RAID_CONFIG, isAntiRaidExempt, shouldAlertOnJoin,
  validateAntiRaidConfig, type AntiRaidConfig, type AntiRaidJoin,
} from './anti-raid-policy';
import { AntiRaidSettings } from './anti-raid-settings.entity';
import { AntiRaidJoinEvent } from './anti-raid-join.entity';
import { AntiRaidAlert } from './anti-raid-alert.entity';

const SNOWFLAKE = /^\d{17,20}$/;
const ALERT_BUCKET_MS = 5 * 60 * 1000;
const JOIN_RETENTION_MS = 60 * 60 * 1000;
const ALERT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function assertGuildId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SNOWFLAKE.test(value)) {
    throw new BadRequestException('Invalid guild ID');
  }
}

export interface AntiRaidDispatch {
  guildId: string;
  alertId: number;
  alertChannelId: string;
  joinCount: number;
  windowSeconds: number;
  minAccountAgeMinutes: number;
}

@Injectable()
export class AntiRaidService {
  private readonly configCache = new Map<string, { config: AntiRaidConfig; expires: number }>();
  private readonly lastPrune = new Map<string, number>();

  constructor(
    @InjectRepository(AntiRaidSettings)
    private readonly settings: Repository<AntiRaidSettings>,
    @InjectRepository(AntiRaidJoinEvent)
    private readonly joins: Repository<AntiRaidJoinEvent>,
    @InjectRepository(AntiRaidAlert)
    private readonly alerts: Repository<AntiRaidAlert>,
  ) {}

  async getConfig(guildId: string): Promise<AntiRaidConfig> {
    assertGuildId(guildId);
    const cached = this.configCache.get(guildId);
    if (cached && cached.expires > Date.now()) return {
      ...cached.config,
      exemptUserIds: [...cached.config.exemptUserIds],
      exemptRoleIds: [...cached.config.exemptRoleIds],
    };
    const row = await this.settings.findOne({ where: { guildId } });
    const config: AntiRaidConfig = row ? {
      enabled: row.enabled,
      mode: row.mode,
      threshold: row.threshold,
      windowSeconds: row.windowSeconds,
      minAccountAgeMinutes: row.minAccountAgeMinutes,
      alertChannelId: row.alertChannelId,
      exemptUserIds: [...row.exemptUserIds],
      exemptRoleIds: [...row.exemptRoleIds],
    } : { ...DEFAULT_ANTI_RAID_CONFIG, exemptUserIds: [], exemptRoleIds: [] };
    if (this.configCache.size >= 500) this.configCache.clear();
    this.configCache.set(guildId, { config, expires: Date.now() + 5000 });
    return { ...config, exemptUserIds: [...config.exemptUserIds], exemptRoleIds: [...config.exemptRoleIds] };
  }

  async setConfig(guildId: string, input: unknown): Promise<AntiRaidConfig> {
    assertGuildId(guildId);
    const problem = validateAntiRaidConfig(input);
    if (problem) throw new BadRequestException(problem);
    const value = input as AntiRaidConfig;
    const config: AntiRaidConfig = {
      enabled: value.enabled,
      mode: 'alert_only',
      threshold: value.threshold,
      windowSeconds: value.windowSeconds,
      minAccountAgeMinutes: value.minAccountAgeMinutes,
      alertChannelId: value.alertChannelId,
      exemptUserIds: [...new Set(value.exemptUserIds)],
      exemptRoleIds: [...new Set(value.exemptRoleIds)],
    };
    await this.settings.save(this.settings.create({ guildId, ...config }));
    this.configCache.delete(guildId);
    return config;
  }

  async recentAlerts(guildId: string): Promise<AntiRaidAlert[]> {
    assertGuildId(guildId);
    return this.alerts.find({
      where: { guildId }, order: { createdAt: 'DESC', id: 'DESC' }, take: 20,
    });
  }

  /**
   * Record a *new* join before counting. DB uniqueness survives reconnects
   * and concurrent gateway workers. No alert is sent for a replay or stale
   * event. An alert bucket is reserved in the DB before any Discord send.
   */
  async observeJoin(join: AntiRaidJoin & { guildId: string }): Promise<AntiRaidDispatch | null> {
    assertGuildId(join?.guildId);
    if (typeof join.userId !== 'string' || !SNOWFLAKE.test(join.userId)) return null;
    const config = await this.getConfig(join.guildId);
    if (!config.enabled || config.mode !== 'alert_only' ||
        !config.alertChannelId || !Array.isArray(join.roleIds) ||
        isAntiRaidExempt(config, join.userId, join.roleIds)) return null;
    const { joinedAtMs, accountCreatedAtMs, observedAtMs } = join;
    if (![joinedAtMs, accountCreatedAtMs, observedAtMs].every(Number.isFinite) ||
        joinedAtMs < accountCreatedAtMs || joinedAtMs > observedAtMs + 2000 ||
        observedAtMs - joinedAtMs > Math.min(config.windowSeconds * 1000, 30000)) {
      return null;
    }

    await this.pruneOldRows(join.guildId, observedAtMs);
    const inserted = await this.joins.createQueryBuilder()
      .insert().into(AntiRaidJoinEvent)
      .values({
        guildId: join.guildId, userId: join.userId,
        joinedAt: new Date(joinedAtMs),
      }).orIgnore().returning('*').execute();
    if (!inserted.raw?.length) return null; // Duplicate event after reconnect/retry.

    const count = await this.joins.count({
      where: {
        guildId: join.guildId,
        joinedAt: Between(
          new Date(observedAtMs - config.windowSeconds * 1000),
          new Date(observedAtMs + 2000),
        ),
      },
    });
    if (!shouldAlertOnJoin(config, join, count)) return null;

    // One pending alert per guild/five-minute bucket even with many workers.
    // No user ID or message content is stored in the alert audit.
    const bucketStart = new Date(Math.floor(observedAtMs / ALERT_BUCKET_MS) * ALERT_BUCKET_MS);
    const alert = await this.alerts.createQueryBuilder()
      .insert().into(AntiRaidAlert)
      .values({
        guildId: join.guildId,
        bucketStart, joinCount: count, windowSeconds: config.windowSeconds,
        status: 'pending', failureReason: null, deliveredAt: null,
      }).orIgnore().returning('*').execute();
    const row: AntiRaidAlert | undefined = alert.raw?.[0];
    if (!row) return null;
    return {
      guildId: join.guildId,
      alertId: row.id,
      alertChannelId: config.alertChannelId,
      joinCount: count,
      windowSeconds: config.windowSeconds,
      minAccountAgeMinutes: config.minAccountAgeMinutes,
    };
  }

  /** Failed only when permissions are *known* missing; uncertain sends stay pending. */
  async finishAlert(
    guildId: string,
    alertId: number,
    outcome: 'sent' | 'missing_permissions',
  ): Promise<boolean> {
    assertGuildId(guildId);
    if (!Number.isSafeInteger(alertId) || alertId < 1) {
      throw new BadRequestException('Invalid anti-raid alert ID');
    }
    const result = await this.alerts.update(
      { guildId, id: alertId, status: 'pending' },
      outcome === 'sent'
        ? { status: 'sent', deliveredAt: new Date(), failureReason: null }
        : { status: 'failed', failureReason: 'missing_permissions' },
    );
    return (result.affected || 0) > 0;
  }

  /** Opportunistic TTL: cron cleanup for quiet guilds is deferred to #90/#91. */
  private async pruneOldRows(guildId: string, now: number): Promise<void> {
    if (now - (this.lastPrune.get(guildId) ?? 0) < ALERT_BUCKET_MS) return;
    await this.joins.delete({
      guildId, joinedAt: LessThan(new Date(now - JOIN_RETENTION_MS)),
    });
    await this.alerts.delete({
      guildId, createdAt: LessThan(new Date(now - ALERT_RETENTION_MS)),
    });
    if (this.lastPrune.size >= 500) this.lastPrune.clear();
    this.lastPrune.set(guildId, now);
  }
}
