import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { DiscordStrategy } from './discord.strategy';
import { DiscordAuthGuard } from './discord-auth.guard';
import { SessionGuard } from './session.guard';
import { FirstPartyRequestGuard } from './first-party-request.guard';
import { Session } from './session.entity';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'discord' }),
    TypeOrmModule.forFeature([Session]),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret || secret.length < 32) {
          throw new Error('JWT_SECRET must be configured with at least 32 characters');
        }
        return { secret, signOptions: { expiresIn: '15m' as const } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [DiscordStrategy, DiscordAuthGuard, SessionGuard, FirstPartyRequestGuard],
})
export class AuthModule {}
