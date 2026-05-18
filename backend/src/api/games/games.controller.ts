import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { EconomyService } from '../../domain/economy/economy.service';
import { RpsDto, TriviaAnswerDto } from './games.dto';

@Controller('games')
export class GamesController {
  constructor(private readonly economyService: EconomyService) {}

  // Store active trivia games for API users
  private activeTriviaGames = new Map<string, { correctIndex: number; reward: number }>();

  private questions = [
    { q: 'What is the capital of France?', options: ['Paris', 'London', 'Berlin', 'Madrid'], correct: 0 },
    { q: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correct: 1 },
    { q: 'What is the largest ocean?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correct: 3 },
    { q: 'Who wrote "Romeo and Juliet"?', options: ['Charles Dickens', 'William Shakespeare', 'Mark Twain', 'Jane Austen'], correct: 1 },
    { q: 'What is the chemical symbol for gold?', options: ['Gd', 'Go', 'Ag', 'Au'], correct: 3 },
  ];

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
  getTriviaQuestion(@Query('userId') userId: string) {
    if (this.activeTriviaGames.has(userId)) {
      return {
        success: false,
        message: 'You already have an active trivia game!',
      };
    }

    const randomIdx = Math.floor(Math.random() * this.questions.length);
    const question = this.questions[randomIdx];
    const reward = 50;

    this.activeTriviaGames.set(userId, { correctIndex: question.correct, reward });

    return {
      success: true,
      question: question.q,
      options: question.options,
      reward,
    };
  }

  @Post('trivia/answer')
  async answerTrivia(@Body() dto: TriviaAnswerDto) {
    const game = this.activeTriviaGames.get(dto.userId);

    if (!game) {
      return {
        success: false,
        message: 'No active trivia game found for this user!',
      };
    }

    this.activeTriviaGames.delete(dto.userId);

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
