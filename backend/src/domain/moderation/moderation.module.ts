import { Module } from '@nestjs/common';
import { AutoModController } from '../../api/automod/automod.controller';
import { AutoModRule } from './automod-rule.entity';
import { AutoModRulesService } from './automod-rules.service';
import { JwtAuthGuard } from '../../api/auth/jwt-auth.guard';
import { GuildAccessGuard } from '../../api/auth/guild-access.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModerationCase } from './moderation-case.entity';
import { ModerationChannelLock } from './moderation-channel-lock.entity';
import { ModerationChannelLockService } from './moderation-channel-lock.service';
import { ModerationPurge } from './moderation-purge.entity';
import { ModerationPurgeService } from './moderation-purge.service';
import { ModerationService } from './moderation.service';
import { ModerationVoiceCase } from './moderation-voice-case.entity';
import { ModerationVoiceCaseService } from './moderation-voice-case.service';

@Module({
  imports: [TypeOrmModule.forFeature([ModerationCase, ModerationPurge, ModerationChannelLock, ModerationVoiceCase])],
  controllers: [AutoModController],
  providers: [AutoModRulesService, JwtAuthGuard, GuildAccessGuard, ModerationService, ModerationPurgeService, ModerationChannelLockService, ModerationVoiceCaseService],
  exports: [AutoModRulesService, ModerationService, ModerationPurgeService, ModerationChannelLockService, ModerationVoiceCaseService],
})
export class ModerationModule {}
