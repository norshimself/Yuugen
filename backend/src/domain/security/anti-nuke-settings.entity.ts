import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { AntiNukeConfig } from './anti-nuke-policy';

@Entity('anti_nuke_settings')
export class AntiNukeSettings implements AntiNukeConfig {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ type: 'varchar', length: 16, default: 'alert_only' })
  mode: 'alert_only';

  @Column({ type: 'integer', default: 3 })
  threshold: number;

  @Column({ type: 'integer', default: 60 })
  windowSeconds: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  alertChannelId: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  exemptActorIds: string[];

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
