import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModerationCase } from './moderation-case.entity';
import { ModerationPurge } from './moderation-purge.entity';
import { ModerationPurgeService } from './moderation-purge.service';
import { ModerationService } from './moderation.service';

@Module({
  imports: [TypeOrmModule.forFeature([ModerationCase, ModerationPurge])],
  providers: [ModerationService, ModerationPurgeService],
  exports: [ModerationService, ModerationPurgeService],
})
export class ModerationModule {}
