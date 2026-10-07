import { IsNotEmpty, IsString } from 'class-validator';

export class ResendCodeDto {
  @IsNotEmpty()
  @IsString()
  phone: string;
}
