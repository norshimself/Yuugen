import { Module } from '@nestjs/common';
import { PlayerController } from './player.controller';
import { PlayerService } from '../../domain/player/player.service';
import { PlayerGateway } from './player.gateway';

@Module({
  controllers: [PlayerController],
  providers: [PlayerService, PlayerGateway],
  exports: [PlayerGateway],
})
export class PlayerModule {}
