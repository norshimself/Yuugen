import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('trivia_sessions')
export class TriviaSession {
  @PrimaryColumn()
  userId: string;

  @Column()
  correctIndex: number;

  @Column()
  reward: number;

  @CreateDateColumn()
  createdAt: Date;
}
