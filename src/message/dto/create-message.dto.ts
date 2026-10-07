import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateMessageDto {
  @IsNumber()
  to_id: number;

  @IsString()
  content: string;
}
