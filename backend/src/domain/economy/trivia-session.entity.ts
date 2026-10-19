import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('trivia_sessions')
export class TriviaSession {
  @PrimaryColumn()
  userId: string;

  @Column()
  correctIndex: number;

  @Column()
  reward: number;

  // Null for sessions created before the recovery migration.
  @Column({ type: 'integer', nullable: true })
  questionId: number | null;

  // Discord prompt ID, preventing stale buttons from answering a newer game.
  @Column({ type: 'varchar', nullable: true })
  messageId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
