import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModerationVoiceCase } from './moderation-voice-case.entity';
import {
  VOICE_SNOWFLAKE,
  cleanVoiceReason,
  type VoiceAction,
} from './voice-policy';

const ACTIONS: readonly VoiceAction[] = [
  'mute', 'unmute', 'deafen', 'undeafen', 'disconnect', 'move',
];

function checkSnowflake(value: unknown, label: string): void {
  if (typeof value !== 'string' || !VOICE_SNOWFLAKE.test(value)) {
    throw new BadRequestException('Invalid ' + label);
  }
}

export interface VoiceCaseInput {
  guildId: string;
  moderatorUserId: string;
  targetUserId: string;
  action: VoiceAction;
  sourceChannelId: string;
  destinationChannelId: string | null;
  reason: string;
}

@Injectable()
export class ModerationVoiceCaseService {
  constructor(
    @InjectRepository(ModerationVoiceCase)
    private readonly cases: Repository<ModerationVoiceCase>,
  ) {}

  /**
   * A partial unique index admits only one pending voice action per
   * guild/target at a time, even across independent bot workers.
   * An uncertain attempt MUST be reconciled rather than retried blindly.
   */
  async begin(input: VoiceCaseInput): Promise<ModerationVoiceCase | null> {
    checkSnowflake(input.guildId, 'guild ID');
    checkSnowflake(input.moderatorUserId, 'moderator ID');
    checkSnowflake(input.targetUserId, 'target ID');
    checkSnowflake(input.sourceChannelId, 'source channel ID');
    if (input.destinationChannelId !== null) {
      checkSnowflake(input.destinationChannelId, 'destination channel ID');
    }
    if (input.moderatorUserId === input.targetUserId) {
      throw new BadRequestException('You cannot moderate yourself');
    }
    if (!ACTIONS.includes(input.action)) {
      throw new BadRequestException('Invalid voice action');
    }
    if (input.action === 'move') {
      if (!input.destinationChannelId ||
          input.destinationChannelId === input.sourceChannelId) {
        throw new BadRequestException('A different destination is required for move');
      }
    } else if (input.destinationChannelId !== null) {
      throw new BadRequestException('Only move actions can have a destination');
    }
    const reason = cleanVoiceReason(input.reason);
    if (!reason) {
      throw new BadRequestException('Reason must be 1 to 512 characters');
    }
    const result = await this.cases.createQueryBuilder()
      .insert()
      .into(ModerationVoiceCase)
      .values({
        guildId: input.guildId,
        moderatorUserId: input.moderatorUserId,
        targetUserId: input.targetUserId,
        action: input.action,
        sourceChannelId: input.sourceChannelId,
        destinationChannelId: input.destinationChannelId,
        reason,
        status: 'pending',
      })
      .orIgnore()
      .returning('*')
      .execute();
    return result.raw?.[0] ?? null;
  }

  /** Transition exactly one pending, guild-owned, action-matched case. */
  async finish(
    guildId: string,
    caseId: number,
    action: VoiceAction,
    outcome: 'completed' | 'failed',
  ): Promise<ModerationVoiceCase | null> {
    checkSnowflake(guildId, 'guild ID');
    if (!Number.isSafeInteger(caseId) || caseId <= 0) {
      throw new BadRequestException('Invalid voice case ID');
    }
    if (!ACTIONS.includes(action)) {
      throw new BadRequestException('Invalid voice action');
    }
    if (outcome !== 'completed' && outcome !== 'failed') {
      throw new BadRequestException('Invalid voice outcome');
    }
    const result = await this.cases.createQueryBuilder()
      .update(ModerationVoiceCase)
      .set({
        status: outcome,
        lastError: outcome === 'failed' ? 'Discord rejected the operation' : null,
        finishedAt: new Date(),
      })
      .where('id = :id', { id: caseId })
      .andWhere('"guildId" = :guildId', { guildId })
      .andWhere('"action" = :action', { action })
      .andWhere('"status" = :status', { status: 'pending' })
      .returning('*')
      .execute();
    return result.raw?.[0] ?? null;
  }

  async recent(
    guildId: string,
    targetUserId: string,
  ): Promise<ModerationVoiceCase[]> {
    checkSnowflake(guildId, 'guild ID');
    checkSnowflake(targetUserId, 'target ID');
    return this.cases.find({
      where: { guildId, targetUserId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 10,
    });
  }
}
