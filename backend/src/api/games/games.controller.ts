import {
  Body,
  Controller,
  Header,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { EconomyService } from '../../domain/economy/economy.service';
import { RpsDto, TriviaAnswerDto } from './games.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('games')
@UseGuards(JwtAuthGuard)
export class GamesController {
  constructor(private readonly economyService: EconomyService) {}

  @Post('rps')
  async playRps(@Req() req: any, @Body() dto: RpsDto) {
    return this.economyService.playRps(req.user.id, dto.choice);
  }

  // POST may create a session or update trivia cooldown. GET would be unsafe.
  // Restores the user's existing question after a reload; expired and
  // pre-migration sessions are replaced automatically.
  @Header('Cache-Control', 'no-store')
  @Post('trivia/question')
  async getTriviaQuestion(@Req() req: any) {
    return this.economyService.getOrStartTrivia(req.user.id);
  }

  @Post('trivia/answer')
  async answerTrivia(@Req() req: any, @Body() dto: TriviaAnswerDto) {
    return this.economyService.answerTrivia(req.user.id, dto.answerIndex);
  }
}
