import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsIn(['whatsapp', 'telegram'])
  channel: 'whatsapp' | 'telegram';
}
