import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModerationPurge } from './moderation-purge.entity';
import { DISCORD_SNOWFLAKE, MAX_PURGE_COUNT, MAX_SCAN_MESSAGES } from '../../bot/commands/moderation/purge-policy';

export interface BeginPurgeInput {
  guildId: string;
  channelId: string;
  moderatorUserId: string;
  filterUserId: string | null;
  reason: string;
  requestedCount: number;
  selectedMessageIds: string[];
  scannedCount: number;
  skippedOldCount: number;
  skippedProtectedCount: number;
}

function snowflake(value: unknown, name: string): void {
  if (typeof value !== 'string' || !DISCORD_SNOWFLAKE.test(value)) {
    throw new BadRequestException('Invalid ' + name);
  }
}
function count(value: number, min: number, max: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new BadRequestException('Invalid ' + name);
  }
}

@Injectable()
export class ModerationPurgeService {
  constructor(
    @InjectRepository(ModerationPurge)
    private readonly purges: Repository<ModerationPurge>,
  ) {}

  async begin(input: BeginPurgeInput): Promise<ModerationPurge> {
    snowflake(input.guildId, 'guild ID');
    snowflake(input.channelId, 'channel ID');
    snowflake(input.moderatorUserId, 'moderator ID');
    if (input.filterUserId !== null) snowflake(input.filterUserId, 'filter user ID');
    count(input.requestedCount, 1, MAX_PURGE_COUNT, 'requested count');
    count(input.scannedCount, 1, MAX_SCAN_MESSAGES, 'scanned count');
    count(input.skippedOldCount, 0, input.scannedCount, 'old count');
    count(input.skippedProtectedCount, 0, input.scannedCount, 'protected count');
    if (!Array.isArray(input.selectedMessageIds) ||
        input.selectedMessageIds.length < 1 ||
        input.selectedMessageIds.length > input.requestedCount ||
        input.selectedMessageIds.length > input.scannedCount ||
        input.selectedMessageIds.some(id => !DISCORD_SNOWFLAKE.test(id)) ||
        new Set(input.selectedMessageIds).size !== input.selectedMessageIds.length) {
      throw new BadRequestException('Invalid selected message IDs');
    }

    const reason = typeof input.reason === 'string'
      ? input.reason.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
      : '';
    if (!reason || reason.length > 512) {
      throw new BadRequestException('Reason must be 1 to 512 characters');
    }

    return this.purges.save(this.purges.create({
      guildId: input.guildId,
      channelId: input.channelId,
      moderatorUserId: input.moderatorUserId,
      filterUserId: input.filterUserId,
      reason,
      requestedCount: input.requestedCount,
      selectedCount: input.selectedMessageIds.length,
      scannedCount: input.scannedCount,
      skippedOldCount: input.skippedOldCount,
      skippedProtectedCount: input.skippedProtectedCount,
      selectedMessageIds: [...input.selectedMessageIds],
      deletedMessageIds: [],
      deletedCount: 0,
      status: 'pending',
    }));
  }

  /**
   * Persist a single terminal outcome; an ambiguous Discord response leaves
   * the record pending for an administrator to reconcile manually.
   */
  async finish(
    guildId: string,
    id: number,
    selectedCount: number,
    deletedIds: string[],
  ): Promise<ModerationPurge | null> {
    snowflake(guildId, 'guild ID');
    count(id, 1, Number.MAX_SAFE_INTEGER, 'purge ID');
    count(selectedCount, 1, MAX_PURGE_COUNT, 'selected count');
    if (!Array.isArray(deletedIds) ||
        deletedIds.length > selectedCount ||
        new Set(deletedIds).size !== deletedIds.length ||
        deletedIds.some(value => !DISCORD_SNOWFLAKE.test(value))) {
      throw new BadRequestException('Invalid deleted IDs');
    }
    const status: ModerationPurge['status'] =
      deletedIds.length === 0 ? 'failed' :
      deletedIds.length === selectedCount ? 'completed' : 'partial';

    const result = await this.purges.createQueryBuilder()
      .update(ModerationPurge)
      .set({
        deletedMessageIds: [...deletedIds],
        deletedCount: deletedIds.length,
        status,
        completedAt: new Date(),
      })
      .where('id = :id', { id })
      .andWhere('"guildId" = :guildId', { guildId })
      .andWhere('"status" = :pending', { pending: 'pending' })
      .returning('*')
      .execute();
    return result.raw?.[0] ?? null;
  }
}
