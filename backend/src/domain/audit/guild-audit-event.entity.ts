import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { GuildAuditType } from './guild-audit-policy';

@Entity('guild_audit_events')
@Index('UQ_guild_audit_event_key', ['guildId', 'eventKey'], { unique: true })
@Index('UQ_guild_audit_minute_slot', ['guildId', 'minuteBucket', 'slot'], { unique: true })
@Index('IDX_guild_audit_created', ['guildId', 'createdAt'])
export class GuildAuditEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'varchar', length: 96 })
  eventKey: string;

  @Column({ type: 'varchar', length: 24 })
  eventType: GuildAuditType;

  @Column({ type: 'varchar', length: 20, nullable: true })
  targetId: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  sourceChannelId: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  actorId: string | null;

  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @Column({ type: 'timestamptz' })
  minuteBucket: Date;

  @Column({ type: 'integer' })
  slot: number;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'sent' | 'failed';

  @Column({ type: 'varchar', length: 32, nullable: true })
  failureReason: 'missing_permissions' | 'config_changed' | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
