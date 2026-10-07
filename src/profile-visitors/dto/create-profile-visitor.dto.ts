import { IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProfileVisitorDto {
  @Type(() => Number)
  @IsInt()
  profileId: number;
}
