import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModerationCase } from './moderation-case.entity';

const SNOWFLAKE = /^\d{17,20}$/;
const REASON_LIMIT = 512;

function validateSnowflake(value: string, name: string): void {
  if (typeof value !== 'string' || !SNOWFLAKE.test(value)) {
    throw new BadRequestException('Invalid ' + name);
  }
}

function normalizedReason(value: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('A reason is required');
  }
  const reason = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim();
  if (reason.length === 0 || reason.length > REASON_LIMIT) {
    throw new BadRequestException('Reason must be 1 to 512 characters');
  }
  return reason;
}

@Injectable()
export class ModerationService {
  constructor(
    @InjectRepository(ModerationCase)
    private readonly cases: Repository<ModerationCase>,
  ) {}

  async warn(
    guildId: string,
    targetUserId: string,
    moderatorUserId: string,
    reason: string,
  ): Promise<ModerationCase> {
    validateSnowflake(guildId, 'guild ID');
    validateSnowflake(targetUserId, 'target ID');
    validateSnowflake(moderatorUserId, 'moderator ID');
    if (targetUserId === moderatorUserId) {
      throw new BadRequestException('You cannot warn yourself');
    }

    return this.cases.save(
      this.cases.create({
        guildId,
        targetUserId,
        moderatorUserId,
        action: 'warn',
        reason: normalizedReason(reason),
      }),
    );
  }

  async warnings(guildId: string, targetUserId: string): Promise<ModerationCase[]> {
    validateSnowflake(guildId, 'guild ID');
    validateSnowflake(targetUserId, 'target ID');
    return this.cases.find({
      where: { guildId, targetUserId, action: 'warn' },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 10,
    });
  }

  async casesForUser(
    guildId: string,
    targetUserId: string,
  ): Promise<ModerationCase[]> {
    validateSnowflake(guildId, 'guild ID');
    validateSnowflake(targetUserId, 'target ID');
    return this.cases.find({
      where: { guildId, targetUserId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 10,
    });
  }

  /**
   * Persist an audit case BEFORE contacting Discord. If Discord rejects the
   * kick, mark the attempt kick_failed; if the process crashes midway, its
   * kick_pending record remains visible for staff reconciliation.
   */
  async beginKick(
    guildId: string,
    targetUserId: string,
    moderatorUserId: string,
    reason: string,
  ): Promise<ModerationCase> {
    validateSnowflake(guildId, 'guild ID');
    validateSnowflake(targetUserId, 'target ID');
    validateSnowflake(moderatorUserId, 'moderator ID');
    if (targetUserId === moderatorUserId) {
      throw new BadRequestException('You cannot kick yourself');
    }
    return this.cases.save(
      this.cases.create({
        guildId,
        targetUserId,
        moderatorUserId,
        action: 'kick_pending',
        reason: normalizedReason(reason),
      }),
    );
  }

  /** Guild-bound conditional transition; repeated finalization is rejected. */
  async finalizeKick(
    guildId: string,
    caseId: number,
    status: 'kick' | 'kick_failed',
  ): Promise<ModerationCase | null> {
    validateSnowflake(guildId, 'guild ID');
    if (!Number.isSafeInteger(caseId) || caseId <= 0) {
      throw new BadRequestException('Invalid kick case ID');
    }
    if (status !== 'kick' && status !== 'kick_failed') {
      throw new BadRequestException('Invalid kick case status');
    }

    const result = await this.cases.createQueryBuilder()
      .update(ModerationCase)
      .set({ action: status })
      .where('id = :id', { id: caseId })
      .andWhere('"guildId" = :guildId', { guildId })
      .andWhere('"action" = :expected', { expected: 'kick_pending' })
      .returning('*')
      .execute();
    return result.raw?.[0] ?? null;
  }

  /**
   * Save the intent to ban BEFORE calling Discord. A pending case is kept
   * if the process exits or the network response is inconclusive.
   */
  async beginBan(
    guildId: string,
    targetUserId: string,
    moderatorUserId: string,
    reason: string,
  ): Promise<ModerationCase> {
    validateSnowflake(guildId, 'guild ID');
    validateSnowflake(targetUserId, 'target ID');
    validateSnowflake(moderatorUserId, 'moderator ID');
    if (targetUserId === moderatorUserId) {
      throw new BadRequestException('You cannot ban yourself');
    }
    return this.cases.save(
      this.cases.create({
        guildId,
        targetUserId,
        moderatorUserId,
        action: 'ban_pending',
        reason: normalizedReason(reason),
      }),
    );
  }

  /**
   * Transition exactly one guild-owned pending case to a terminal state.
   * A replay, another guild's case, or an already-finalized case is rejected.
   */
  async finalizeBan(
    guildId: string,
    caseId: number,
    status: 'ban' | 'ban_failed',
  ): Promise<ModerationCase | null> {
    validateSnowflake(guildId, 'guild ID');
    if (!Number.isSafeInteger(caseId) || caseId <= 0) {
      throw new BadRequestException('Invalid ban case ID');
    }
    if (status !== 'ban' && status !== 'ban_failed') {
      throw new BadRequestException('Invalid ban case status');
    }

    const result = await this.cases.createQueryBuilder()
      .update(ModerationCase)
      .set({ action: status })
      .where('id = :id', { id: caseId })
      .andWhere('"guildId" = :guildId', { guildId })
      .andWhere('"action" = :expected', { expected: 'ban_pending' })
      .returning('*')
      .execute();
    return result.raw?.[0] ?? null;
  }

  async unwarn(
    guildId: string,
    caseId: number,
    moderatorUserId: string,
    reason = 'Removed by moderator',
  ): Promise<ModerationCase | null> {
    validateSnowflake(guildId, 'guild ID');
    validateSnowflake(moderatorUserId, 'moderator ID');
    if (!Number.isSafeInteger(caseId) || caseId <= 0) {
      throw new BadRequestException('Invalid warning case ID');
    }

    // Atomic conditional update prevents two moderators from revoking a case
    // twice and never exposes or modifies cases belonging to another guild.
    const changed = await this.cases.createQueryBuilder()
      .update(ModerationCase)
      .set({
        revokedAt: new Date(),
        revokedByUserId: moderatorUserId,
        revocationReason: normalizedReason(reason),
      })
      .where('id = :id', { id: caseId })
      .andWhere('"guildId" = :guildId', { guildId })
      .andWhere('action = :action', { action: 'warn' })
      .andWhere('"revokedAt" IS NULL')
      .returning('*')
      .execute();

    const updated: unknown = changed.raw?.[0];
    return updated ? (updated as ModerationCase) : null;
  }
}
