import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ChannelLockStatus =
  | 'lock_pending'
  | 'locked'
  | 'unlock_pending'
  | 'unlocked'
  | 'failed';

/** Each attempt persists its snapshot and outcome; active locks are unique. */
@Entity('moderation_channel_locks')
@Index('IDX_channel_locks_guild_channel_created', ['guildId', 'channelId', 'createdAt'])
@Index('UQ_channel_locks_active', ['guildId', 'channelId'], {
  unique: true,
  where: "\"status\" IN ('lock_pending', 'locked', 'unlock_pending')",
})
export class ModerationChannelLock {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'varchar', length: 20 })
  channelId: string;

  @Column({ type: 'varchar', length: 20 })
  lockedByUserId: string;

  @Column({ type: 'varchar', length: 512 })
  lockReason: string;

  @Column({ type: 'boolean' })
  originalExisted: boolean;

  @Column({ type: 'varchar', length: 80 })
  originalAllow: string;

  @Column({ type: 'varchar', length: 80 })
  originalDeny: string;

  @Column({ type: 'varchar', length: 80 })
  lockedAllow: string;

  @Column({ type: 'varchar', length: 80 })
  lockedDeny: string;

  @Column({ type: 'varchar', length: 24, default: 'lock_pending' })
  status: ChannelLockStatus;

  @Column({ type: 'timestamptz', nullable: true })
  lockedAt: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  unlockedByUserId: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  unlockReason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  unlockedAt: Date | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastErrorAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
