import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('trivia_questions')
export class TriviaQuestion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  question: string;

  @Column('simple-array')
  options: string[];

  @Column()
  correctIndex: number;
}
