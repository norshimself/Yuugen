import { Module } from '@nestjs/common';
import { EconomyController } from './economy.controller';
import { EconomyModule as DomainEconomyModule } from '../../domain/economy/economy.module';

@Module({
  imports: [DomainEconomyModule],
  controllers: [EconomyController],
})
export class EconomyApiModule {}
