import { IsNotEmpty, IsString, IsNumber, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RpsDto {
  @ApiProperty({ description: 'Your choice: rock, paper, or scissors' })
  @IsString()
  @IsNotEmpty()
  @IsIn(['rock', 'paper', 'scissors'])
  choice: string;
}

export class TriviaAnswerDto {
  @ApiProperty({ description: 'The index of the answer (0-3)' })
  @IsNumber()
  answerIndex: number;
}
