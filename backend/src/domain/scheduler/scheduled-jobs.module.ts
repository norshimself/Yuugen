import { Module } from '@nestjs/common';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { ScheduledJobsRegistry } from './scheduled-jobs.registry';
import { ScheduledJobsWorker } from './scheduled-jobs.worker';
import { ScheduledJobsController } from './scheduled-jobs.controller';
import { JwtAuthGuard } from '../../api/auth/jwt-auth.guard';
import { GuildAccessGuard } from '../../api/auth/guild-access.guard';

@Module({
  controllers: [ScheduledJobsController],
  providers: [ScheduledJobsService, ScheduledJobsRegistry, ScheduledJobsWorker, JwtAuthGuard, GuildAccessGuard],
  exports: [ScheduledJobsService, ScheduledJobsRegistry],
})
export class ScheduledJobsModule {}
