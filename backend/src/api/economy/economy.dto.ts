import { IsNotEmpty, IsString, IsInt, Min, Max, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GambleDto {
  @ApiProperty({ description: 'The amount of coins to gamble' })
  @IsInt()
  @Min(1)
  @Max(100000)
  amount: number;
}

export class RobDto {
  @ApiProperty({ description: 'The Discord User ID of the target' })
  @IsString()
  @Matches(/^\d{17,20}$/)
  targetId: string;
}

export class BuyDto {
  @ApiProperty({ description: 'The ID of the item to buy' })
  @IsString()
  @IsNotEmpty()
  itemId: string;
}
