import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { DiscordStrategy } from './discord.strategy';
import { Session } from './session.entity';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'discord' }),
    TypeOrmModule.forFeature([Session]),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'default_jwt_secret',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [DiscordStrategy],
})
export class AuthModule {}
