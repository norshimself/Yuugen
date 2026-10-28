import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModerationCase } from './moderation-case.entity';
import { ModerationChannelLock } from './moderation-channel-lock.entity';
import { ModerationChannelLockService } from './moderation-channel-lock.service';
import { ModerationPurge } from './moderation-purge.entity';
import { ModerationPurgeService } from './moderation-purge.service';
import { ModerationService } from './moderation.service';

@Module({
  imports: [TypeOrmModule.forFeature([ModerationCase, ModerationPurge, ModerationChannelLock])],
  providers: [ModerationService, ModerationPurgeService, ModerationChannelLockService],
  exports: [ModerationService, ModerationPurgeService, ModerationChannelLockService],
})
export class ModerationModule {}
