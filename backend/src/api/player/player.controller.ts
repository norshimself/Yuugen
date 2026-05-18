import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { PlayerService } from '../../domain/player/player.service';
import { PlayDto, GuildOnlyDto, VolumeDto, RemoveDto, SeekDto, LoopDto, FilterDto } from './player.dto';

@Controller('player')
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  @Post('play')
  async play(@Body() playDto: PlayDto) {
    return this.playerService.play(playDto.guildId, playDto.query, playDto.channelId);
  }

  @Post('pause')
  async pause(@Body() dto: GuildOnlyDto) {
    return this.playerService.pause(dto.guildId);
  }

  @Post('resume')
  async resume(@Body() dto: GuildOnlyDto) {
    return this.playerService.resume(dto.guildId);
  }

  @Post('skip')
  async skip(@Body() dto: GuildOnlyDto) {
    return this.playerService.skip(dto.guildId);
  }

  @Post('stop')
  async stop(@Body() dto: GuildOnlyDto) {
    return this.playerService.stop(dto.guildId);
  }

  @Post('volume')
  async volume(@Body() dto: VolumeDto) {
    return this.playerService.setVolume(dto.guildId, dto.level);
  }

  @Get('queue')
  async getQueue(@Query('guildId') guildId: string) {
    return this.playerService.getQueue(guildId);
  }

  @Post('shuffle')
  async shuffle(@Body() dto: GuildOnlyDto) {
    return this.playerService.shuffle(dto.guildId);
  }

  @Post('clear')
  async clear(@Body() dto: GuildOnlyDto) {
    return this.playerService.clear(dto.guildId);
  }

  @Post('remove')
  async remove(@Body() dto: RemoveDto) {
    return this.playerService.remove(dto.guildId, dto.index);
  }

  @Post('seek')
  async seek(@Body() dto: SeekDto) {
    return this.playerService.seek(dto.guildId, dto.seconds);
  }

  @Post('loop')
  async loop(@Body() dto: LoopDto) {
    return this.playerService.setLoopMode(dto.guildId, dto.mode);
  }

  @Post('filter')
  async filter(@Body() dto: FilterDto) {
    return this.playerService.applyFilter(dto.guildId, dto.type);
  }

  @Get('nowplaying')
  async getNowPlaying(@Query('guildId') guildId: string) {
    return this.playerService.getNowPlaying(guildId);
  }
}
