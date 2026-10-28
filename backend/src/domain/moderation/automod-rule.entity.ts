import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('automod_rules')
@Index('IDX_automod_rules_guild_priority', ['guildId', 'priority', 'id'])
export class AutoModRule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'varchar', length: 48 })
  name: string;

  @Column({ default: false })
  enabled: boolean;

  @Column({ type: 'varchar', length: 24 })
  kind: 'blocked_phrases' | 'message_rate';

  @Column({ type: 'varchar', length: 16, default: 'dry_run' })
  action: 'dry_run' | 'delete';

  @Column({ type: 'integer', default: 100 })
  priority: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  phrases: string[];

  @Column({ type: 'integer', default: 6 })
  threshold: number;

  @Column({ type: 'integer', default: 8 })
  windowSeconds: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  exemptChannelIds: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  exemptRoleIds: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
