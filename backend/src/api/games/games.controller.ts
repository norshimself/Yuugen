import { Controller, Post, Body, Get, Query, UseGuards } from '@nestjs/common';
import { EconomyService } from '../../domain/economy/economy.service';
import { RpsDto, TriviaAnswerDto } from './games.dto';
import { UserIdDto } from '../economy/economy.dto';
import { ApiKeyGuard } from '../auth/api-key.guard';

@Controller('games')
@UseGuards(ApiKeyGuard)
export class GamesController {
  constructor(private readonly economyService: EconomyService) {}

  @Post('rps')
  async playRps(@Body() dto: RpsDto) {
    const choices = ['rock', 'paper', 'scissors'];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];
    const userChoice = dto.choice;

    let result = '';
    let won = false;
    let tie = false;

    if (userChoice === botChoice) {
      result = 'tie';
      tie = true;
    } else if (
      (userChoice === 'rock' && botChoice === 'scissors') ||
      (userChoice === 'paper' && botChoice === 'rock') ||
      (userChoice === 'scissors' && botChoice === 'paper')
    ) {
      result = 'win';
      won = true;
    } else {
      result = 'lose';
    }

    const reward = 20;
    let newBalance = undefined;

    if (won) {
      newBalance = await this.economyService.addCoins(dto.userId, reward);
    }

    return {
      success: true,
      userChoice,
      botChoice,
      result,
      reward: won ? reward : 0,
      newBalance,
    };
  }

  @Get('trivia/question')
  async getTriviaQuestion(@Query() query: UserIdDto) {
    const userId = query.userId;
    const activeSession = await this.economyService.getTriviaSession(userId);
    if (activeSession) {
      return {
        success: false,
        message: 'You already have an active trivia game!',
      };
    }

    const question = await this.economyService.getRandomTriviaQuestion();
    const reward = 50;

    await this.economyService.startTriviaSession(userId, question.correctIndex, reward);

    return {
      success: true,
      question: question.question,
      options: question.options,
      reward,
    };
  }

  @Post('trivia/answer')
  async answerTrivia(@Body() dto: TriviaAnswerDto) {
    const game = await this.economyService.getTriviaSession(dto.userId);

    if (!game) {
      return {
        success: false,
        message: 'No active trivia game found for this user!',
      };
    }

    await this.economyService.deleteTriviaSession(dto.userId);

    const isCorrect = dto.answerIndex === game.correctIndex;
    let newBalance = undefined;

    if (isCorrect) {
      newBalance = await this.economyService.addCoins(dto.userId, game.reward);
    }

    return {
      success: true,
      correct: isCorrect,
      correctIndex: game.correctIndex,
      reward: isCorrect ? game.reward : 0,
      newBalance,
    };
  }
}
