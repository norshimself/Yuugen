import { Module } from '@nestjs/common';
import { PlayerController } from './player.controller';
import { PlayerService } from '../../domain/player/player.service';
import { PlayerGateway } from './player.gateway';
import { GuildAccessGuard } from '../auth/guild-access.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  controllers: [PlayerController],
  providers: [PlayerService, PlayerGateway, JwtAuthGuard, GuildAccessGuard],
  exports: [PlayerGateway],
})
export class PlayerModule {}
