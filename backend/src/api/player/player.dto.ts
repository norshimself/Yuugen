import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class PlayDto {
  @IsString()
  @IsNotEmpty()
  guildId: string;

  @IsString()
  @IsOptional()
  channelId?: string;

  @IsString()
  @IsNotEmpty()
  query: string;
}

export class GuildOnlyDto {
  @IsString()
  @IsNotEmpty()
  guildId: string;
}

export class VolumeDto {
  @IsString()
  @IsNotEmpty()
  guildId: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  level: number;
}

export class RemoveDto {
  @IsString()
  @IsNotEmpty()
  guildId: string;

  @IsNumber()
  @Min(1)
  index: number;
}

export class SeekDto {
  @IsString()
  @IsNotEmpty()
  guildId: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  seconds?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  position?: number;
}

export class LoopDto {
  @IsString()
  @IsNotEmpty()
  guildId: string;

  @IsString()
  @IsNotEmpty()
  mode: string;
}

export class FilterDto {
  @IsString()
  @IsNotEmpty()
  guildId: string;

  @IsString()
  @IsNotEmpty()
  type: string;
}

export class PlayRadioDto {
  @IsString()
  @IsNotEmpty()
  guildId: string;

  @IsString()
  @IsNotEmpty()
  streamUrl: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  tags?: string;

  @IsString()
  @IsOptional()
  channelId?: string;

  @IsString()
  @IsOptional()
  artworkUrl?: string;
}

export class RemovePlaylistDto {
  @IsString()
  @IsNotEmpty()
  guildId: string;

  @IsString()
  @IsNotEmpty()
  playlistId: string;
}

