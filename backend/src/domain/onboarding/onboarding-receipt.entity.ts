import {
  Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn,
} from 'typeorm';
import type { OnboardingReceiptKind } from './onboarding-policy';

@Entity('guild_onboarding_receipts')
@Index('UQ_guild_onboarding_event',
  ['guildId', 'userId', 'kind', 'sessionKey'], { unique: true })
@Index('UQ_guild_onboarding_first_dm',
  ['guildId', 'userId'], {
    unique: true,
    where: '"kind" = \'welcome_dm\'',
  })
@Index('UQ_guild_onboarding_minute_slot',
  ['guildId', 'minuteBucket', 'slot'], { unique: true })
export class OnboardingReceipt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'varchar', length: 20 })
  userId: string;

  @Column({ type: 'varchar', length: 16 })
  kind: OnboardingReceiptKind;

  @Column({ type: 'varchar', length: 16 })
  sessionKey: string;

  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @Column({ type: 'timestamptz' })
  minuteBucket: Date;

  @Column({ type: 'integer' })
  slot: number;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'sent' | 'failed';

  @Column({ type: 'varchar', length: 32, nullable: true })
  failureReason: 'missing_permissions' | 'dm_unavailable' | 'config_changed' | null;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
