import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { VoiceAction } from '../../bot/commands/moderation/voice-policy';

export type VoiceCaseStatus = 'pending' | 'completed' | 'failed';

/**
 * Metadata-only voice action audit. Pending is intentionally retained when
 * Discord's outcome is unknown; no automatic replay of a voice action.
 */
@Entity('moderation_voice_cases')
@Index('IDX_moderation_voice_guild_target_created', ['guildId', 'targetUserId', 'createdAt'])
@Index('UQ_moderation_voice_pending', ['guildId', 'targetUserId'], {
  unique: true,
  where: "\"status\" = 'pending'",
})
export class ModerationVoiceCase {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'varchar', length: 20 })
  moderatorUserId: string;

  @Column({ type: 'varchar', length: 20 })
  targetUserId: string;

  @Column({ type: 'varchar', length: 24 })
  action: VoiceAction;

  @Column({ type: 'varchar', length: 20 })
  sourceChannelId: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  destinationChannelId: string | null;

  @Column({ type: 'varchar', length: 512 })
  reason: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: VoiceCaseStatus;

  @Column({ type: 'varchar', length: 128, nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
