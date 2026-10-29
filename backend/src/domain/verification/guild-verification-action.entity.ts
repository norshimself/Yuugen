import {
  Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('guild_verification_actions')
@Index('UQ_verify_action_event', ['guildId', 'eventKey'], { unique: true })
@Index('IDX_verify_action_guild_time', ['guildId', 'createdAt'])
export class GuildVerificationAction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'varchar', length: 96 })
  eventKey: string;

  @Column({ type: 'varchar', length: 20 })
  userId: string;

  @Column({ type: 'varchar', length: 20 })
  actorId: string;

  @Column({ type: 'varchar', length: 16 })
  sessionKey: string;

  @Column({ type: 'varchar', length: 24 })
  action: 'join' | 'verify' | 'wrong_answer' | 'override';

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'succeeded' | 'denied' | 'failed' | 'uncertain';

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
