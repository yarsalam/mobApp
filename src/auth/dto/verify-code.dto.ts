import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

export class VerifyCodeDto {
  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsNotEmpty()
  @IsString()
  @Length(4, 4) // کد باید بین 4 تا 6 رقم باشد
  code: string;

  @IsOptional()
  @IsString()
  channel?: string;
}
