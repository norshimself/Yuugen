import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import {
  DEFAULT_GUILD_AUDIT, auditEventKey, shouldAudit, validAuditTime,
  validateGuildAuditConfig, type GuildAuditConfig, type GuildAuditType,
} from './guild-audit-policy';
import { GuildAuditConfigEntity } from './guild-audit-config.entity';
import { GuildAuditEvent } from './guild-audit-event.entity';

const SNOWFLAKE = /^\d{17,20}$/;
const MAX_EVENTS_PER_MINUTE = 20;
const ONE_MINUTE = 60_000;
const RETENTION_MS = 7 * 24 * 60 * ONE_MINUTE;

function validId(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE.test(value);
}
function checkGuild(value: unknown): asserts value is string {
  if (!validId(value)) throw new BadRequestException('Invalid guild ID');
}

export interface GuildAuditInput {
  guildId: string;
  eventType: GuildAuditType;
  eventId: string;
  revision: number;
  occurredAtMs: number;
  observedAtMs: number;
  targetId: string | null;
  sourceChannelId: string | null;
  // Actor attribution is allowed only for Discord's trusted kick audit log.
  actorId: string | null;
}

export interface GuildAuditDispatch {
  id: number;
  guildId: string;
  logChannelId: string;
  eventType: GuildAuditType;
  targetId: string | null;
  sourceChannelId: string | null;
  actorId: string | null;
}

@Injectable()
export class GuildAuditService {
  private readonly cache = new Map<string, { config: GuildAuditConfig; expires: number }>();
  private readonly lastPruned = new Map<string, number>();
  private readonly saturated = new Map<string, number>();

  constructor(
    @InjectRepository(GuildAuditConfigEntity)
    private readonly configs: Repository<GuildAuditConfigEntity>,
    @InjectRepository(GuildAuditEvent)
    private readonly events: Repository<GuildAuditEvent>,
  ) {}

  async getConfig(guildId: string, fresh = false): Promise<GuildAuditConfig> {
    checkGuild(guildId);
    const cached = this.cache.get(guildId);
    if (!fresh && cached && cached.expires > Date.now()) {
      return { ...cached.config, selectedEvents: [...cached.config.selectedEvents] };
    }
    const row = await this.configs.findOne({ where: { guildId } });
    const config: GuildAuditConfig = row ? {
      enabled: row.enabled,
      logChannelId: row.logChannelId,
      selectedEvents: [...row.selectedEvents],
    } : { ...DEFAULT_GUILD_AUDIT, selectedEvents: [] };
    if (this.cache.size >= 500) this.cache.clear();
    this.cache.set(guildId, { config, expires: Date.now() + 5000 });
    return { ...config, selectedEvents: [...config.selectedEvents] };
  }

  async setConfig(guildId: string, input: unknown): Promise<GuildAuditConfig> {
    checkGuild(guildId);
    const error = validateGuildAuditConfig(input);
    if (error) throw new BadRequestException(error);
    const value = input as GuildAuditConfig;
    const config: GuildAuditConfig = {
      enabled: value.enabled,
      logChannelId: value.logChannelId,
      selectedEvents: [...value.selectedEvents],
    };
    await this.configs.save(this.configs.create({ guildId, ...config }));
    this.cache.delete(guildId);
    return config;
  }

  async history(guildId: string): Promise<GuildAuditEvent[]> {
    checkGuild(guildId);
    return this.events.find({
      where: { guildId }, order: { createdAt: 'DESC', id: 'DESC' }, take: 30,
    });
  }

  /**
   * Reserves a unique event and a unique rate-limit slot in PostgreSQL before
   * posting to Discord. Replays/reconnects and concurrent workers can never
   * send the same event twice. The DB enforces a maximum of 20/minute/guild;
   * no message content or reasons are ever persisted.
   */
  async reserve(input: GuildAuditInput): Promise<GuildAuditDispatch | null> {
    checkGuild(input?.guildId);
    const key = auditEventKey(input.eventType, input.eventId, input.revision);
    if (!key || !validAuditTime(input.occurredAtMs, input.observedAtMs) ||
        (input.targetId !== null && !validId(input.targetId)) ||
        (input.sourceChannelId !== null && !validId(input.sourceChannelId))) {
      return null;
    }
    const config = await this.getConfig(input.guildId);
    if (!config.logChannelId ||
        !shouldAudit(config, input.eventType, input.sourceChannelId)) return null;
    const now = input.observedAtMs;
    if (now < (this.saturated.get(input.guildId) || 0)) return null;

    // A duplicate event should not consume another minute slot.
    if (await this.events.findOne({
      where: { guildId: input.guildId, eventKey: key },
    })) return null;

    await this.pruneOld(input.guildId, now);
    const minuteBucket = new Date(Math.floor(now / ONE_MINUTE) * ONE_MINUTE);
    for (let slot = 0; slot < MAX_EVENTS_PER_MINUTE; slot++) {
      const claimed = await this.events.createQueryBuilder()
        .insert().into(GuildAuditEvent)
        .values({
          guildId: input.guildId,
          eventKey: key,
          eventType: input.eventType,
          targetId: input.targetId,
          sourceChannelId: input.sourceChannelId,
          actorId: input.eventType === 'member_kick' && validId(input.actorId)
            ? input.actorId : null,
          occurredAt: new Date(input.occurredAtMs),
          minuteBucket,
          slot,
          status: 'pending',
          failureReason: null,
          deliveredAt: null,
        }).orIgnore().returning('*').execute();
      const row: GuildAuditEvent | undefined = claimed.raw?.[0];
      if (row) {
        return {
          id: row.id, guildId: input.guildId,
          logChannelId: config.logChannelId,
          eventType: input.eventType,
          targetId: row.targetId,
          sourceChannelId: row.sourceChannelId,
          actorId: row.actorId,
        };
      }
      // A concurrent worker may already have inserted the same event ID.
      if (await this.events.findOne({
        where: { guildId: input.guildId, eventKey: key },
      })) return null;
    }
    if (this.saturated.size >= 500) this.saturated.clear();
    this.saturated.set(input.guildId, minuteBucket.getTime() + ONE_MINUTE);
    return null;
  }

  /** Known permission problems are failed; ambiguous sends stay pending. */
  async finish(
    guildId: string,
    id: number,
    outcome: 'sent' | 'missing_permissions',
  ): Promise<boolean> {
    checkGuild(guildId);
    if (!Number.isSafeInteger(id) || id < 1 ||
        !['sent', 'missing_permissions'].includes(outcome)) {
      throw new BadRequestException('Invalid audit result');
    }
    const updated = await this.events.update(
      { guildId, id, status: 'pending' },
      outcome === 'sent'
        ? { status: 'sent', deliveredAt: new Date(), failureReason: null }
        : { status: 'failed', failureReason: 'missing_permissions' },
    );
    return (updated.affected || 0) > 0;
  }

  private async pruneOld(guildId: string, now: number): Promise<void> {
    if (now - (this.lastPruned.get(guildId) || 0) < 10 * ONE_MINUTE) return;
    await this.events.delete({
      guildId, createdAt: LessThan(new Date(now - RETENTION_MS)),
    });
    if (this.lastPruned.size >= 500) this.lastPruned.clear();
    this.lastPruned.set(guildId, now);
  }
}
