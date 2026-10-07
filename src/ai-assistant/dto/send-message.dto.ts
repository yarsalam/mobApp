import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  message: string;
}
