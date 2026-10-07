import {
  IsNotEmpty,
  IsPhoneNumber,
  IsOptional,
  IsIn,
  IsString,
} from 'class-validator';

export class CreateUserPhoneDto {
  @IsNotEmpty()
  @IsPhoneNumber('IR')
  phone: string;

  @IsOptional()
  @IsIn(['whatsapp', 'telegram'])
  channel?: 'whatsapp' | 'telegram';

  // واتساپ: OTP سمت فرانت تولید میشه و اینجا میاد
  @IsOptional()
  @IsString()
  otp?: string;
}
