import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModerationCase } from './moderation-case.entity';
import { ModerationService } from './moderation.service';

@Module({
  imports: [TypeOrmModule.forFeature([ModerationCase])],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
