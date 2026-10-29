import {
  Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn,
} from 'typeorm';
import type {
  VerificationMode, VerificationStatus,
} from './verification-policy';

@Entity('guild_verification_configs')
export class GuildVerificationConfig {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'varchar', length: 20 })
  channelId: string;

  @Column({ type: 'varchar', length: 20 })
  quarantineRoleId: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  messageId: string | null;

  @Column({ type: 'varchar', length: 12 })
  mode: VerificationMode;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status: VerificationStatus;

  @Column({ type: 'integer', default: 1 })
  revision: number;

  @Column({ type: 'varchar', length: 45, nullable: true })
  questionPrompt: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  answerSalt: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  answerDigest: string | null;

  @Column({ type: 'varchar', length: 20 })
  updatedByUserId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
