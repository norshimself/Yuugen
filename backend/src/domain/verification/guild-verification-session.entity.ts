import {
  Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn,
} from 'typeorm';
import type { VerificationSessionStatus } from './verification-policy';

@Entity('guild_verification_sessions')
@Index('IDX_guild_verify_session_status', ['guildId', 'status'])
export class GuildVerificationSession {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  guildId: string;

  @PrimaryColumn({ type: 'varchar', length: 20 })
  userId: string;

  @Column({ type: 'varchar', length: 16 })
  sessionKey: string;

  @Column({ type: 'varchar', length: 20 })
  quarantineRoleId: string;

  @Column({ type: 'varchar', length: 24 })
  status: VerificationSessionStatus;

  @Column({ type: 'varchar', length: 36, nullable: true })
  claimToken: string | null;

  @Column({ type: 'integer', default: 0 })
  wrongAnswers: number;

  @Column({ type: 'timestamptz', nullable: true })
  releasedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
