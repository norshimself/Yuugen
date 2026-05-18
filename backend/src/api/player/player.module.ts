import { Module } from '@nestjs/common';
import { PlayerController } from './player.controller';
import { PlayerService } from '../../domain/player/player.service';

@Module({
  controllers: [PlayerController],
  providers: [PlayerService],
})
export class PlayerModule {}
