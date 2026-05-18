import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max } from 'class-validator';

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
  @Min(0)
  seconds: number;
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
