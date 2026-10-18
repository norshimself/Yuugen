import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { PlayerService } from '../../domain/player/player.service';
import {
  PlayDto,
  JoinDto,
  GuildOnlyDto,
  VolumeDto,
  RemoveDto,
  SeekDto,
  LoopDto,
  FilterDto,
  PlayRadioDto,
  RemovePlaylistDto,
} from './player.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AllowGuildless, GuildAccessGuard } from '../auth/guild-access.guard';

@Controller('player')
@UseGuards(JwtAuthGuard, GuildAccessGuard)
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  @Post('play')
  async play(@Body() playDto: PlayDto) {
    return this.playerService.play(
      playDto.guildId,
      playDto.query,
      playDto.channelId,
    );
  }
  @Post('join')
  async join(@Body() body: JoinDto) {
    return this.playerService.join(body.guildId, body.channelId);
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
  async getQueue(@Query() query: GuildOnlyDto) {
    return this.playerService.getQueue(query.guildId);
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

  @Post('remove-playlist')
  async removePlaylist(@Body() dto: RemovePlaylistDto) {
    return this.playerService.removePlaylist(dto.guildId, dto.playlistId);
  }

  @Post('seek')
  async seek(@Body() dto: SeekDto) {
    const seconds =
      dto.position !== undefined
        ? Math.floor(dto.position / 1000)
        : dto.seconds || 0;
    return this.playerService.seek(dto.guildId, seconds);
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
  async getNowPlaying(@Query() query: GuildOnlyDto) {
    return this.playerService.getNowPlaying(query.guildId);
  }

  @AllowGuildless()
  @Get('guilds')
  async getGuilds(@Req() req: any) {
    return this.playerService.getGuilds(req.user.id);
  }

  @AllowGuildless()
  @Get('recommendations')
  async getRecommendations(@Query('tag') tag: string) {
    return this.playerService.getRecommendations(tag);
  }

  @AllowGuildless()
  @Get('search')
  async search(@Query('query') query: string) {
    return this.playerService.search(query);
  }

  @Get('channels')
  async getChannels(@Query('guildId') guildId: string, @Req() req: any) {
    return this.playerService.getVoiceChannels(guildId, req.user.id);
  }

  @AllowGuildless()
  @Get('radio/countries')
  async getRadioCountries() {
    return this.playerService.getRadioCountries();
  }

  @AllowGuildless()
  @Get('radio/search')
  async searchRadio(
    @Query('query') query?: string,
    @Query('country') country?: string,
  ) {
    return this.playerService.searchRadio(query, country);
  }

  @AllowGuildless()
  @Get('live/atmospheres')
  async getLiveAtmospheres() {
    return this.playerService.getLiveAtmospheres();
  }

  @Post('radio/play')
  async playRadio(@Body() dto: PlayRadioDto) {
    return this.playerService.playRadio(
      dto.guildId,
      dto.streamUrl,
      dto.name,
      dto.tags,
      dto.channelId,
      dto.artworkUrl,
    );
  }
}
