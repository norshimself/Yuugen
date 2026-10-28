import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('moderation_cases')
@Index('IDX_moderation_cases_guild_target_created', [
  'guildId',
  'targetUserId',
  'createdAt',
])
export class ModerationCase {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'varchar', length: 20 })
  targetUserId: string;

  @Column({ type: 'varchar', length: 20 })
  moderatorUserId: string;

  // Values: warn, kick_pending/kick/kick_failed, ban_pending/ban/ban_failed.
  @Column({ type: 'varchar', length: 24, default: 'warn' })
  action: string;

  @Column({ type: 'varchar', length: 512 })
  reason: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  // Warnings are revoked, not deleted, so the audit trail is preserved.
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  revokedByUserId: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  revocationReason: string | null;
}
