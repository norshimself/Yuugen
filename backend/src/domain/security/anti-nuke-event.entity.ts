import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { AntiNukeKind } from './anti-nuke-policy';

@Entity('anti_nuke_events')
@Index('UQ_anti_nuke_guild_audit', ['guildId', 'auditEntryId'], { unique: true })
@Index('IDX_anti_nuke_guild_time', ['guildId', 'eventAt'])
export class AntiNukeEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'varchar', length: 20 })
  auditEntryId: string;

  @Column({ type: 'varchar', length: 32 })
  kind: AntiNukeKind;

  @Column({ type: 'varchar', length: 20, nullable: true })
  targetId: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  actorId: string | null;

  @Column({ type: 'timestamptz' })
  eventAt: Date;
}
