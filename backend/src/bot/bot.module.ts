import { Module } from '@nestjs/common';
import { BotGateway } from './bot.gateway';
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
import { StatusService } from '../shared/status.service';

@Module({
  imports: [EconomyModule],
  providers: [
    BotGateway,
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
    StatusService,
  ],
})
export class BotModule {}
