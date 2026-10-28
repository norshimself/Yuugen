import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GuildAccessGuard } from '../../api/auth/guild-access.guard';
import { JwtAuthGuard } from '../../api/auth/jwt-auth.guard';
import { AntiNukeController } from '../../api/anti-nuke/anti-nuke.controller';
import { AntiNukeAlert } from './anti-nuke-alert.entity';
import { AntiNukeEvent } from './anti-nuke-event.entity';
import { AntiNukeSettings } from './anti-nuke-settings.entity';
import { AntiNukeService } from './anti-nuke.service';

@Module({
  imports: [TypeOrmModule.forFeature([AntiNukeSettings, AntiNukeEvent, AntiNukeAlert])],
  controllers: [AntiNukeController],
  providers: [AntiNukeService, JwtAuthGuard, GuildAccessGuard],
  exports: [AntiNukeService],
})
export class AntiNukeModule {}
