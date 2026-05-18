import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NecordModule } from 'necord';
import { NecordLavalinkModule } from '@necord/lavalink';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntentsBitField } from 'discord.js';
import { AppController } from './api/app/app.controller';
import { AppService } from './api/app/app.service';
import { AuthModule } from './api/auth/auth.module';
import { PlayerModule } from './api/player/player.module';
import { BotModule } from './bot/bot.module';
import { StatusService } from './shared/status.service';
import { EconomyModule } from './domain/economy/economy.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    PlayerModule,
    BotModule,
    EconomyModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL') || 'postgres://postgres:password@postgres:5432/discord_bot',
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: true, // Note: turn off in production
      }),
      inject: [ConfigService],
    }),
    NecordModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const devGuild = configService.get<string>('DEVELOPMENT_GUILD_ID');
        return {
          token: configService.get<string>('DISCORD_TOKEN') || '',
          intents: [
            IntentsBitField.Flags.Guilds,
            IntentsBitField.Flags.GuildMessages,
            IntentsBitField.Flags.GuildVoiceStates,
          ],
          development: devGuild ? [devGuild] : [],
        };
      },
      inject: [ConfigService],
    }),
    NecordLavalinkModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        nodes: [
          {
            id: 'main_node',
            host: 'lavalink',
            port: 2333,
            authorization: configService.get<string>('LAVALINK_PASSWORD') || '',
          },
        ],
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    StatusService,
  ],
})
export class AppModule {}
