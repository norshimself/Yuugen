import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('user_profiles')
export class UserProfile {
  @PrimaryColumn()
  userId: string;

  @Column({ default: 0 })
  xp: number;

  @Column({ default: 1 })
  level: number;

  @Column({ default: 100 }) // Starting balance
  coins: number;

  @Column({ default: 0 })
  bank: number;

  @Column({ type: 'timestamp', nullable: true })
  lastDaily: Date;
}
