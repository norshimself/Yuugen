import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { AntiNukeKind } from './anti-nuke-policy';

@Entity('anti_nuke_alerts')
@Index('UQ_anti_nuke_alert_bucket', ['guildId', 'bucketStart'], { unique: true })
@Index('IDX_anti_nuke_alerts_guild_created', ['guildId', 'createdAt'])
export class AntiNukeAlert {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'timestamptz' })
  bucketStart: Date;

  @Column({ type: 'integer' })
  eventCount: number;

  @Column({ type: 'integer' })
  windowSeconds: number;

  @Column({ type: 'varchar', length: 32 })
  triggeredBy: AntiNukeKind;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'sent' | 'failed';

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  failureReason: 'missing_permissions' | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  reviewedById: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  disposition: 'legitimate' | 'suspicious' | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
