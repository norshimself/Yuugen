import { Controller, Post, Body, Get, Query, UseGuards, Req } from '@nestjs/common';
import { EconomyService } from '../../domain/economy/economy.service';
import { GambleDto, RobDto, BuyDto } from './economy.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('economy')
@UseGuards(JwtAuthGuard)
export class EconomyController {
  constructor(private readonly economyService: EconomyService) {}

  @Get('profile')
  async getProfile(@Req() req: any) {
    return this.economyService.getProfile(req.user.id);
  }

  @Post('daily')
  async daily(@Req() req: any) {
    return this.economyService.claimDaily(req.user.id);
  }

  @Get('leaderboard')
  async getLeaderboard(@Query('limit') limit?: number) {
    return this.economyService.getLeaderboard(limit ? Number(limit) : 10);
  }

  @Post('gamble')
  async gamble(@Req() req: any, @Body() dto: GambleDto) {
    return this.economyService.gamble(req.user.id, dto.amount);
  }

  @Post('work')
  async work(@Req() req: any) {
    return this.economyService.work(req.user.id);
  }

  @Post('crime')
  async crime(@Req() req: any) {
    return this.economyService.crime(req.user.id);
  }

  @Post('rob')
  async rob(@Req() req: any, @Body() dto: RobDto) {
    return this.economyService.rob(req.user.id, dto.targetId);
  }

  @Get('shop')
  async getShop() {
    return this.economyService.getShopItems();
  }

  @Post('buy')
  async buy(@Req() req: any, @Body() dto: BuyDto) {
    return this.economyService.buyItem(req.user.id, dto.itemId);
  }
}
