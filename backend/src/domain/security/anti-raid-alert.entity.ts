import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AntiRaidAlertStatus = 'pending' | 'sent' | 'failed';

/** Metadata-only alert audit; alert delivery is at most once per five-minute bucket. */
@Entity('anti_raid_alerts')
@Index('IDX_anti_raid_alerts_guild_created', ['guildId', 'createdAt'])
@Index('UQ_anti_raid_alert_bucket', ['guildId', 'bucketStart'], { unique: true })
export class AntiRaidAlert {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'timestamptz' })
  bucketStart: Date;

  @Column({ type: 'integer' })
  joinCount: number;

  @Column({ type: 'integer' })
  windowSeconds: number;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: AntiRaidAlertStatus;

  @Column({ type: 'varchar', length: 32, nullable: true })
  failureReason: 'missing_permissions' | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  reviewedByUserId: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  reviewDisposition: 'legitimate' | 'suspicious' | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
