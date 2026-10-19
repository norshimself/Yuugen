import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserProfile } from './user-profile.entity';
import { ShopItem } from './shop-item.entity';
import { TriviaQuestion } from './trivia-question.entity';
import { TriviaSession } from './trivia-session.entity';
import { EconomyService } from './economy.service';
import { MessageListener } from '../../bot/listeners/message.listener';
import { SettingsModule } from '../../api/settings/settings.module';

@Module({
  imports: [
    SettingsModule,
    TypeOrmModule.forFeature([
      UserProfile,
      ShopItem,
      TriviaQuestion,
      TriviaSession,
    ]),
  ],
  providers: [EconomyService, MessageListener],
  exports: [EconomyService],
})
export class EconomyModule {}
