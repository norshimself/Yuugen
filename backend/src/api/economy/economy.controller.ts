import { Controller, Post, Body, Get, Query, UseGuards } from '@nestjs/common';
import { EconomyService } from '../../domain/economy/economy.service';
import { UserIdDto, GambleDto, RobDto, BuyDto } from './economy.dto';
import { ApiKeyGuard } from '../auth/api-key.guard';

@Controller('economy')
@UseGuards(ApiKeyGuard)
export class EconomyController {
  constructor(private readonly economyService: EconomyService) {}

  @Get('profile')
  async getProfile(@Query() query: UserIdDto) {
    return this.economyService.getProfile(query.userId);
  }

  @Post('daily')
  async daily(@Body() dto: UserIdDto) {
    return this.economyService.claimDaily(dto.userId);
  }

  @Get('leaderboard')
  async getLeaderboard(@Query('limit') limit?: number) {
    return this.economyService.getLeaderboard(limit ? Number(limit) : 10);
  }

  @Post('gamble')
  async gamble(@Body() dto: GambleDto) {
    return this.economyService.gamble(dto.userId, dto.amount);
  }

  @Post('work')
  async work(@Body() dto: UserIdDto) {
    return this.economyService.work(dto.userId);
  }

  @Post('crime')
  async crime(@Body() dto: UserIdDto) {
    return this.economyService.crime(dto.userId);
  }

  @Post('rob')
  async rob(@Body() dto: RobDto) {
    return this.economyService.rob(dto.userId, dto.targetId);
  }

  @Get('shop')
  async getShop() {
    return this.economyService.getShopItems();
  }

  @Post('buy')
  async buy(@Body() dto: BuyDto) {
    return this.economyService.buyItem(dto.userId, dto.itemId);
  }
}
