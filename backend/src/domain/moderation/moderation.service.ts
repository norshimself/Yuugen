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
