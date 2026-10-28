import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ModerationChannelLock } from './moderation-channel-lock.entity';
import { CHANNEL_SNOWFLAKE, getChannelLockReason, type LockSnapshot } from './channel-lock-policy';

function checkId(value: unknown, label: string): void {
  if (typeof value !== 'string' || !CHANNEL_SNOWFLAKE.test(value)) {
    throw new BadRequestException('Invalid ' + label);
  }
}

@Injectable()
export class ModerationChannelLockService {
  constructor(
    @InjectRepository(ModerationChannelLock)
    private readonly locks: Repository<ModerationChannelLock>,
  ) {}

  async getActive(
    guildId: string,
    channelId: string,
  ): Promise<ModerationChannelLock | null> {
    checkId(guildId, 'guild ID');
    checkId(channelId, 'channel ID');
    return this.locks.findOne({
      where: {
        guildId, channelId,
        status: In(['lock_pending', 'locked', 'unlock_pending']),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  /** Atomic INSERT + partial unique index allows only one active guild/channel lock. */
  async beginLock(
    guildId: string,
    channelId: string,
    actorId: string,
    reason: string,
    snapshot: LockSnapshot,
  ): Promise<ModerationChannelLock | null> {
    checkId(guildId, 'guild ID');
    checkId(channelId, 'channel ID');
    checkId(actorId, 'moderator ID');
    const clean = getChannelLockReason(reason);
    if (!clean) throw new BadRequestException('Reason must be 1 to 512 characters');
    if (!snapshot || typeof snapshot.originalExisted !== 'boolean' ||
        !/^\d{1,80}$/.test(snapshot.originalAllow) ||
        !/^\d{1,80}$/.test(snapshot.originalDeny) ||
        !/^\d{1,80}$/.test(snapshot.lockedAllow) ||
        !/^\d{1,80}$/.test(snapshot.lockedDeny)) {
      throw new BadRequestException('Invalid permission snapshot');
    }

    const result = await this.locks.createQueryBuilder()
      .insert()
      .into(ModerationChannelLock)
      .values({
        guildId, channelId, lockedByUserId: actorId, lockReason: clean,
        originalExisted: snapshot.originalExisted,
        originalAllow: snapshot.originalAllow,
        originalDeny: snapshot.originalDeny,
        lockedAllow: snapshot.lockedAllow,
        lockedDeny: snapshot.lockedDeny,
        status: 'lock_pending',
      })
      .orIgnore()
      .returning('*')
      .execute();
    return result.raw?.[0] ?? null;
  }

  async finishLock(
    guildId: string,
    id: number,
    outcome: 'locked' | 'failed',
  ): Promise<ModerationChannelLock | null> {
    checkId(guildId, 'guild ID');
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new BadRequestException('Invalid lock ID');
    }
    if (outcome !== 'locked' && outcome !== 'failed') {
      throw new BadRequestException('Invalid lock outcome');
    }
    const result = await this.locks.createQueryBuilder()
      .update(ModerationChannelLock)
      .set({
        status: outcome,
        lockedAt: outcome === 'locked' ? new Date() : null,
        lastError: outcome === 'failed' ? 'Discord rejected lock' : null,
        lastErrorAt: outcome === 'failed' ? new Date() : null,
      })
      .where('id = :id', { id })
      .andWhere('"guildId" = :guildId', { guildId })
      .andWhere('"status" = :pending', { pending: 'lock_pending' })
      .returning('*')
      .execute();
    return result.raw?.[0] ?? null;
  }

  async beginUnlock(
    guildId: string,
    id: number,
    actorId: string,
    reason: string,
  ): Promise<ModerationChannelLock | null> {
    checkId(guildId, 'guild ID');
    checkId(actorId, 'moderator ID');
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new BadRequestException('Invalid lock ID');
    }
    const clean = getChannelLockReason(reason);
    if (!clean) throw new BadRequestException('Reason must be 1 to 512 characters');
    const result = await this.locks.createQueryBuilder()
      .update(ModerationChannelLock)
      .set({
        status: 'unlock_pending',
        unlockedByUserId: actorId,
        unlockReason: clean,
      })
      .where('id = :id', { id })
      .andWhere('"guildId" = :guildId', { guildId })
      .andWhere('"status" = :locked', { locked: 'locked' })
      .returning('*')
      .execute();
    return result.raw?.[0] ?? null;
  }

  async finishUnlock(
    guildId: string,
    id: number,
    outcome: 'unlocked' | 'locked',
  ): Promise<ModerationChannelLock | null> {
    checkId(guildId, 'guild ID');
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new BadRequestException('Invalid lock ID');
    }
    if (outcome !== 'unlocked' && outcome !== 'locked') {
      throw new BadRequestException('Invalid unlock outcome');
    }
    const result = await this.locks.createQueryBuilder()
      .update(ModerationChannelLock)
      .set({
        status: outcome,
        unlockedAt: outcome === 'unlocked' ? new Date() : null,
        lastError: outcome === 'locked' ? 'Discord rejected unlock' : null,
        lastErrorAt: outcome === 'locked' ? new Date() : null,
      })
      .where('id = :id', { id })
      .andWhere('"guildId" = :guildId', { guildId })
      .andWhere('"status" = :pending', { pending: 'unlock_pending' })
      .returning('*')
      .execute();
    return result.raw?.[0] ?? null;
  }
}
