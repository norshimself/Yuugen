import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from '../../api/auth/session.entity';
import { JwtAuthGuard } from '../../api/auth/jwt-auth.guard';
import { FirstPartyRequestGuard } from '../../api/auth/first-party-request.guard';
import { GuildAccessGuard } from '../../api/auth/guild-access.guard';
import { UserProfile } from '../economy/user-profile.entity';
import { TriviaSession } from '../economy/trivia-session.entity';
import { GuildSettings } from '../settings/guild-settings.entity';
import { AutoModRule } from '../moderation/automod-rule.entity';
import { PrivacyService } from './privacy.service';
import { PrivacyRetentionWorker } from './privacy-retention.worker';
import { PrivacySelfController, PrivacyGuildController } from './privacy.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Session, UserProfile, TriviaSession, GuildSettings, AutoModRule,
    ]),
  ],
  controllers: [PrivacySelfController, PrivacyGuildController],
  providers: [
    PrivacyService, PrivacyRetentionWorker,
    JwtAuthGuard, FirstPartyRequestGuard, GuildAccessGuard,
  ],
})
export class PrivacyModule {}
