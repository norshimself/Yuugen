import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('role_panel_member_locks')
export class RolePanelMemberLock {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  guildId: string;

  @PrimaryColumn({ type: 'varchar', length: 20 })
  userId: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  token: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastActionAt: Date | null;
}
