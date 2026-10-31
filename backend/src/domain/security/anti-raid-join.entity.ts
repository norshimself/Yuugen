import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Short-lived metadata for restart-safe join windows and event deduplication. */
@Entity('anti_raid_joins')
@Index('IDX_anti_raid_joins_guild_joined', ['guildId', 'joinedAt'])
@Index('UQ_anti_raid_join_event', ['guildId', 'userId', 'joinedAt'], { unique: true })
export class AntiRaidJoinEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'varchar', length: 20 })
  userId: string;

  @Column({ type: 'timestamptz' })
  joinedAt: Date;
}
