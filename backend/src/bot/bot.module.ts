import { Module } from '@nestjs/common';
import { BotGateway } from './bot.gateway';
import { AutoModMessageListener } from './listeners/automod.listener';
import { PingCommand } from './commands/ping.command';
import { PlayCommand } from './commands/player/play.command';
import { QueueCommand } from './commands/player/queue.command';
import { SkipCommand } from './commands/player/skip.command';
import { StopCommand } from './commands/player/stop.command';
import { PauseCommand } from './commands/player/pause.command';
import { VolumeCommand } from './commands/player/volume.command';
import { ResumeCommand } from './commands/player/resume.command';
import { ShuffleCommand } from './commands/player/shuffle.command';
import { ClearCommand } from './commands/player/clear.command';
import { RemoveCommand } from './commands/player/remove.command';
import { SeekCommand } from './commands/player/seek.command';
import { LoopCommand } from './commands/player/loop.command';
import { NowPlayingCommand } from './commands/player/nowplaying.command';
import { LyricsCommand } from './commands/player/lyrics.command';
import { RadioCommand } from './commands/player/radio.command';
import { FilterCommand } from './commands/player/filter.command';

import { EconomyModule } from '../domain/economy/economy.module';
import { SettingsModule } from '../api/settings/settings.module';
import { ModerationModule } from '../domain/moderation/moderation.module';
import { ModerationCommands } from './commands/moderation/moderation.command';
import { VoiceModerationCommands } from './commands/moderation/voice-moderation.command';
import { RankCommand } from './commands/economy/rank.command';
import { DailyCommand } from './commands/economy/daily.command';
import { LeaderboardCommand } from './commands/economy/leaderboard.command';
import { BalanceCommand } from './commands/economy/balance.command';
import { GambleCommand } from './commands/economy/gamble.command';
import { WorkCommand } from './commands/economy/work.command';
import { CrimeCommand } from './commands/economy/crime.command';
import { RobCommand } from './commands/economy/rob.command';
import { ShopCommand } from './commands/economy/shop.command';
import { BuyCommand } from './commands/economy/buy.command';
import { TriviaCommand } from './commands/economy/trivia.command';
import { RpsCommand } from './commands/economy/rps.command';
import { WelcomeListener } from './listeners/welcome.listener';
import { TicketModule } from '../domain/tickets/ticket.module';
import { TicketCommands } from './commands/tickets/ticket.command';
import { TicketChannelEvents } from './commands/tickets/ticket-channel.events';

@Module({
  imports: [EconomyModule, SettingsModule, ModerationModule, TicketModule],
  providers: [
    BotGateway,
    AutoModMessageListener,
    PingCommand,
    PlayCommand,
    QueueCommand,
    SkipCommand,
    StopCommand,
    PauseCommand,
    VolumeCommand,
    ResumeCommand,
    ShuffleCommand,
    ClearCommand,
    RemoveCommand,
    SeekCommand,
    LoopCommand,
    NowPlayingCommand,
    LyricsCommand,
    RadioCommand,
    FilterCommand,
    RankCommand,
    DailyCommand,
    LeaderboardCommand,
    BalanceCommand,
    GambleCommand,
    WorkCommand,
    CrimeCommand,
    RobCommand,
    ShopCommand,
    BuyCommand,
    TriviaCommand,
    RpsCommand,
    ModerationCommands,
    VoiceModerationCommands,
    WelcomeListener,
    TicketCommands,
    TicketChannelEvents,
  ],
})
export class BotModule {}
