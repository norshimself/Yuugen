import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../../api/auth/jwt-auth.guard';
import { GuildAccessGuard } from '../../api/auth/guild-access.guard';
import { GuildAuditController } from '../../api/audit/guild-audit.controller';
import { GuildAuditConfigEntity } from './guild-audit-config.entity';
import { GuildAuditEvent } from './guild-audit-event.entity';
import { GuildAuditService } from './guild-audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([GuildAuditConfigEntity, GuildAuditEvent])],
  controllers: [GuildAuditController],
  providers: [GuildAuditService, JwtAuthGuard, GuildAccessGuard],
  exports: [GuildAuditService],
})
export class GuildAuditModule {}
