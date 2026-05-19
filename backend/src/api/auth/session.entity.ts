import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('sessions')
export class Session {
  @PrimaryColumn()
  id: string; // The session token (random string)

  @Column()
  userId: string; // The Discord User ID

  @Column()
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
