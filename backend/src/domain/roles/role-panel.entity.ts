import {
  Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import type {
  RolePanelMode, RolePanelOption, RolePanelStatus,
} from './role-panel-policy';

@Entity('role_panels')
@Index('IDX_role_panels_guild_status', ['guildId', 'status'])
@Index('UQ_role_panel_message', ['guildId', 'messageId'], { unique: true })
export class RolePanel {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  guildId: string;

  @Column({ type: 'varchar', length: 20 })
  channelId: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  messageId: string | null;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'varchar', length: 12 })
  mode: RolePanelMode;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status: RolePanelStatus;

  @Column({ type: 'integer', default: 0 })
  revision: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  options: RolePanelOption[];

  @Column({ type: 'varchar', length: 20 })
  createdByUserId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
