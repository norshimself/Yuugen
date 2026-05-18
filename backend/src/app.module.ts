import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NecordModule } from 'necord';
import { NecordLavalinkModule } from '@necord/lavalink';
import { IntentsBitField } from 'discord.js';
import { AppController } from './api/app/app.controller';
import { AppService } from './api/app/app.service';
import { AuthModule } from './api/auth/auth.module';
import { PlayerModule } from './api/player/player.module';
import { BotModule } from './bot/bot.module';
import { StatusService } from './common/status.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    PlayerModule,
    BotModule,
    NecordModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        token: configService.get<string>('DISCORD_TOKEN') || '',
        intents: [
          IntentsBitField.Flags.Guilds,
          IntentsBitField.Flags.GuildMessages,
          IntentsBitField.Flags.GuildVoiceStates,
        ],
        development: process.env.DEVELOPMENT_GUILD_ID ? [process.env.DEVELOPMENT_GUILD_ID] : [],
      }),
      inject: [ConfigService],
    }),
    NecordLavalinkModule.forRoot({
      nodes: [
        {
          id: 'main_node',
          host: 'lavalink',
          port: 2333,
          authorization: process.env.LAVALINK_PASSWORD || '',
        },
      ],
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    StatusService,
  ],
})
export class AppModule {}
