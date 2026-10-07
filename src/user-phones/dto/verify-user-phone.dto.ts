import { IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class VerifyUserPhoneDto {
  @IsNotEmpty()
  phone: string;

  @IsOptional()
  code?: string;

  @IsNotEmpty()
  @IsIn(['whatsapp', 'telegram'])
  channel: 'whatsapp' | 'telegram';
}
