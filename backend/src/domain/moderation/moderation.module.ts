import { Module } from '@nestjs/common';
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
  providers: [ModerationService, ModerationPurgeService, ModerationChannelLockService, ModerationVoiceCaseService],
  exports: [ModerationService, ModerationPurgeService, ModerationChannelLockService, ModerationVoiceCaseService],
})
export class ModerationModule {}
