import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GuildVerificationConfig } from './guild-verification-config.entity';
import { GuildVerificationSession } from './guild-verification-session.entity';
import { GuildVerificationAction } from './guild-verification-action.entity';
import { VerificationService } from './verification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GuildVerificationConfig, GuildVerificationSession, GuildVerificationAction,
    ]),
  ],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
