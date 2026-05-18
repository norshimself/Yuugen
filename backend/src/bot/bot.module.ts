import { Module } from '@nestjs/common';
import { BotGateway } from './bot.gateway';
import { PingCommand } from './commands/ping.command';
import { PlayCommand } from './commands/player_commands/play.command';
import { QueueCommand } from './commands/player_commands/queue.command';
import { SkipCommand } from './commands/player_commands/skip.command';
import { StopCommand } from './commands/player_commands/stop.command';
import { PauseCommand } from './commands/player_commands/pause.command';
import { VolumeCommand } from './commands/player_commands/volume.command';
import { ResumeCommand } from './commands/player_commands/resume.command';
import { ShuffleCommand } from './commands/player_commands/shuffle.command';
import { ClearCommand } from './commands/player_commands/clear.command';
import { RemoveCommand } from './commands/player_commands/remove.command';
import { SeekCommand } from './commands/player_commands/seek.command';
import { LoopCommand } from './commands/player_commands/loop.command';
import { NowPlayingCommand } from './commands/player_commands/nowplaying.command';
import { LyricsCommand } from './commands/player_commands/lyrics.command';
import { RadioCommand } from './commands/player_commands/radio.command';
import { FilterCommand } from './commands/player_commands/filter.command';

@Module({
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
  ],
})
export class BotModule {}
