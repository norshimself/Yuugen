import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { AntiRaidConfig } from './anti-raid-policy';

@Entity('anti_raid_settings')
export class AntiRaidSettings implements AntiRaidConfig {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ type: 'varchar', length: 16, default: 'alert_only' })
  mode: 'alert_only';

  @Column({ type: 'integer', default: 10 })
  threshold: number;

  @Column({ type: 'integer', default: 60 })
  windowSeconds: number;

  @Column({ type: 'integer', default: 1440 })
  minAccountAgeMinutes: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  alertChannelId: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  exemptUserIds: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  exemptRoleIds: string[];

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
