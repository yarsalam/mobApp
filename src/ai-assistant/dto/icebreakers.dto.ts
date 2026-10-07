import { IsNotEmpty, IsNumber } from 'class-validator';

export class IcebreakersDto {
  @IsNotEmpty()
  @IsNumber()
  targetUserId: number;
}
