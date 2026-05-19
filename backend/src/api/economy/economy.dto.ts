import { IsNotEmpty, IsString, IsNumber, IsPositive } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GambleDto {
  @ApiProperty({ description: 'The amount of coins to gamble' })
  @IsNumber()
  @IsPositive()
  amount: number;
}

export class RobDto {
  @ApiProperty({ description: 'The Discord User ID of the target' })
  @IsString()
  @IsNotEmpty()
  targetId: string;
}

export class BuyDto {
  @ApiProperty({ description: 'The ID of the item to buy' })
  @IsString()
  @IsNotEmpty()
  itemId: string;
}
