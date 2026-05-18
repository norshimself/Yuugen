import { IsNotEmpty, IsString, IsNumber, IsPositive } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UserIdDto {
  @ApiProperty({ description: 'The Discord User ID' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class GambleDto {
  @ApiProperty({ description: 'The Discord User ID' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'The amount of coins to gamble' })
  @IsNumber()
  @IsPositive()
  amount: number;
}

export class RobDto {
  @ApiProperty({ description: 'The Discord User ID of the robber' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'The Discord User ID of the target' })
  @IsString()
  @IsNotEmpty()
  targetId: string;
}

export class BuyDto {
  @ApiProperty({ description: 'The Discord User ID' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'The ID of the item to buy' })
  @IsString()
  @IsNotEmpty()
  itemId: string;
}
