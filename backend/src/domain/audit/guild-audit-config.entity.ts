import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { GuildAuditConfig, GuildAuditType } from './guild-audit-policy';

@Entity('guild_audit_configs')
export class GuildAuditConfigEntity implements GuildAuditConfig {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  logChannelId: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  selectedEvents: GuildAuditType[];

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
