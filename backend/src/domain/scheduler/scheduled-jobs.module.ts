import { Module } from '@nestjs/common';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { ScheduledJobsRegistry } from './scheduled-jobs.registry';
import { ScheduledJobsWorker } from './scheduled-jobs.worker';

@Module({
  providers: [ScheduledJobsService, ScheduledJobsRegistry, ScheduledJobsWorker],
  exports: [ScheduledJobsService, ScheduledJobsRegistry],
})
export class ScheduledJobsModule {}
