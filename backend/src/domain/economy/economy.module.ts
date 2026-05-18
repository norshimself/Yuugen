import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserProfile } from './user-profile.entity';
import { EconomyService } from './economy.service';
import { MessageListener } from '../../bot/listeners/message.listener';

@Module({
  imports: [TypeOrmModule.forFeature([UserProfile])],
  providers: [EconomyService, MessageListener],
  exports: [EconomyService],
})
export class EconomyModule {}
