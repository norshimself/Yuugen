import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { DiscordStrategy } from './discord.strategy';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'discord' })],
  controllers: [AuthController],
  providers: [DiscordStrategy],
})
export class AuthModule {}
