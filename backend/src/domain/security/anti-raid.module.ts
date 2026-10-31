import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../../api/auth/jwt-auth.guard';
import { GuildAccessGuard } from '../../api/auth/guild-access.guard';
import { AntiRaidController } from '../../api/anti-raid/anti-raid.controller';
import { AntiRaidAlert } from './anti-raid-alert.entity';
import { AntiRaidJoinEvent } from './anti-raid-join.entity';
import { AntiRaidSettings } from './anti-raid-settings.entity';
import { AntiRaidService } from './anti-raid.service';

@Module({
  imports: [TypeOrmModule.forFeature([AntiRaidSettings, AntiRaidJoinEvent, AntiRaidAlert])],
  providers: [AntiRaidService, JwtAuthGuard, GuildAccessGuard],
  controllers: [AntiRaidController],
  exports: [AntiRaidService],
})
export class AntiRaidModule {}
