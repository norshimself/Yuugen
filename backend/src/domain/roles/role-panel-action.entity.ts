import {
  Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('role_panel_actions')
@Index('UQ_role_panel_action_interaction', ['interactionId'], { unique: true })
@Index('IDX_role_panel_actions_guild_created', ['guildId', 'createdAt'])
export class RolePanelAction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  interactionId: string;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'varchar', length: 20 })
  userId: string;

  @Column({ type: 'integer' })
  panelId: number;

  @Column({ type: 'integer' })
  optionId: number;

  @Column({ type: 'varchar', length: 20 })
  roleId: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'added' | 'removed' | 'partial' | 'uncertain' | 'denied';

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
