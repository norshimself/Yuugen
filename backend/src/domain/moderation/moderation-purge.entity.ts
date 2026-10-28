import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Audit metadata and message snowflakes ONLY. Message contents, attachments
 * and embeds must never be copied into the moderation purge audit.
 */
@Entity('moderation_purges')
@Index('IDX_moderation_purges_guild_created', ['guildId', 'createdAt'])
export class ModerationPurge {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'varchar', length: 20 })
  channelId: string;

  @Column({ type: 'varchar', length: 20 })
  moderatorUserId: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  filterUserId: string | null;

  @Column({ type: 'varchar', length: 512 })
  reason: string;

  @Column({ type: 'integer' })
  requestedCount: number;

  @Column({ type: 'integer' })
  selectedCount: number;

  @Column({ type: 'integer' })
  scannedCount: number;

  @Column({ type: 'integer', default: 0 })
  skippedOldCount: number;

  @Column({ type: 'integer', default: 0 })
  skippedProtectedCount: number;

  @Column({ type: 'jsonb' })
  selectedMessageIds: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  deletedMessageIds: string[];

  @Column({ type: 'integer', default: 0 })
  deletedCount: number;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'completed' | 'partial' | 'failed';

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
