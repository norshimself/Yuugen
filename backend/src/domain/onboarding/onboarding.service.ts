import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import {
  type OnboardingOutcome, type OnboardingReceiptKind,
  validOnboardingReceipt, validSessionKey, validSnowflake,
} from './onboarding-policy';
import { OnboardingReceipt } from './onboarding-receipt.entity';

const ONE_MINUTE = 60_000;
const MAX_PER_MINUTE = 30;
const RECEIPT_RETENTION_MS = 30 * 24 * 60 * ONE_MINUTE;

@Injectable()
export class OnboardingService {
  private readonly lastPrune = new Map<string, number>();
  private readonly saturated = new Map<string, number>();

  constructor(
    @InjectRepository(OnboardingReceipt)
    private readonly receipts: Repository<OnboardingReceipt>,
  ) {}

  /**
   * Reserve *before* sending. A duplicate gateway event, restart, or
   * concurrent worker may not claim the same session twice. The partial
   * unique DM index ensures a member receives at most one onboarding DM per
   * guild, across all joins, until the member's receipt is explicitly erased.
   */
  async reserve(
    guildId: string,
    userId: string,
    kind: OnboardingReceiptKind,
    sessionKey: string,
    nowMs: number,
  ): Promise<number | null> {
    if (!validOnboardingReceipt(guildId, userId, kind, sessionKey) ||
        !Number.isSafeInteger(nowMs) || nowMs <= 0) return null;
    if (nowMs < (this.saturated.get(guildId) || 0)) return null;
    const existing = await this.receipts.findOne({
      where: { guildId, userId, kind, sessionKey },
    });
    if (existing) return null;
    if (kind === 'welcome_dm' &&
        await this.receipts.findOne({ where: { guildId, userId, kind } })) {
      return null;
    }

    await this.pruneOld(guildId, nowMs);
    const bucketStart = Math.floor(nowMs / ONE_MINUTE) * ONE_MINUTE;
    const minuteBucket = new Date(bucketStart);
    for (let slot = 0; slot < MAX_PER_MINUTE; slot++) {
      const inserted = await this.receipts.createQueryBuilder()
        .insert().into(OnboardingReceipt)
        .values({
          guildId, userId, kind, sessionKey,
          occurredAt: new Date(nowMs), minuteBucket, slot,
          status: 'pending', failureReason: null, deliveredAt: null,
          acknowledgedAt: null,
        }).orIgnore().returning('*').execute();
      const id = inserted.raw?.[0]?.id;
      if (Number.isSafeInteger(id) && id > 0) return id;
      // A concurrent gateway worker may have claimed this event or DM.
      if (await this.receipts.findOne({
        where: { guildId, userId, kind, sessionKey },
      })) return null;
      if (kind === 'welcome_dm' &&
          await this.receipts.findOne({ where: { guildId, userId, kind } })) {
        return null;
      }
    }
    if (this.saturated.size >= 500) this.saturated.clear();
    this.saturated.set(guildId, bucketStart + ONE_MINUTE);
    return null;
  }

  /** Preserve ambiguous network outcomes as pending: never blindly retry. */
  async finish(
    guildId: string,
    id: number,
    outcome: OnboardingOutcome,
  ): Promise<boolean> {
    if (!validSnowflake(guildId) || !Number.isSafeInteger(id) || id < 1 ||
        !['sent', 'missing_permissions', 'dm_unavailable', 'config_changed']
          .includes(outcome)) {
      throw new BadRequestException('Invalid onboarding result');
    }
    const result = await this.receipts.update(
      { guildId, id, status: 'pending' },
      outcome === 'sent'
        ? { status: 'sent', deliveredAt: new Date(), failureReason: null }
        : { status: 'failed', failureReason: outcome },
    );
    return (result.affected || 0) > 0;
  }

  /**
   * Acknowledgement is user-bound and one-time, not a role grant or
   * membership verification bypass. UI must verify current membership and
   * match the signed Discord user before calling.
   */
  async acknowledge(
    guildId: string, userId: string, sessionKey: string,
  ): Promise<boolean> {
    if (!validSnowflake(guildId) || !validSnowflake(userId) ||
        !validSessionKey(sessionKey)) return false;
    const result = await this.receipts.update(
      {
        guildId, userId, sessionKey,
        kind: 'welcome_dm',
        acknowledgedAt: IsNull(),
        status: In(['pending', 'sent']),
      },
      { acknowledgedAt: new Date() },
    );
    return (result.affected || 0) > 0;
  }

  /**
   * Public join/leave metadata is cleared on later activity; first-DM
   * receipts are intentionally retained for idempotency across re-joins.
   * Guild deletion/privacy lifecycle cleanup is a separate prerequisite.
   */
  private async pruneOld(guildId: string, nowMs: number): Promise<void> {
    if (nowMs - (this.lastPrune.get(guildId) || 0) < 10 * ONE_MINUTE) return;
    await this.receipts.delete({
      guildId,
      kind: In(['welcome', 'goodbye']),
      createdAt: LessThan(new Date(nowMs - RECEIPT_RETENTION_MS)),
    });
    if (this.lastPrune.size >= 500) this.lastPrune.clear();
    this.lastPrune.set(guildId, nowMs);
  }
}
