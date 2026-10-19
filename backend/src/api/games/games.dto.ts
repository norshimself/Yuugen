import { IsNotEmpty, IsString, IsInt, Min, Max, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RpsDto {
  @ApiProperty({ description: 'Your choice: rock, paper, or scissors' })
  @IsString()
  @IsNotEmpty()
  @IsIn(['rock', 'paper', 'scissors'])
  choice: 'rock' | 'paper' | 'scissors';
}

export class TriviaAnswerDto {
  @ApiProperty({ description: 'The index of the answer (0-3)' })
  @IsInt()
  @Min(0)
  @Max(3)
  answerIndex: number;
}
