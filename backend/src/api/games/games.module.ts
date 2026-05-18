import { Module } from '@nestjs/common';
import { GamesController } from './games.controller';
import { EconomyModule } from '../../domain/economy/economy.module';

@Module({
  imports: [EconomyModule],
  controllers: [GamesController],
})
export class GamesApiModule {}
