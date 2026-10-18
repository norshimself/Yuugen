import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GuildSettings } from '../../domain/settings/guild-settings.entity';
import { SettingsService } from '../../domain/settings/settings.service';
import { SettingsController } from './settings.controller';
import { GuildAccessGuard } from '../auth/guild-access.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  imports: [TypeOrmModule.forFeature([GuildSettings])],
  providers: [SettingsService, JwtAuthGuard, GuildAccessGuard],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
