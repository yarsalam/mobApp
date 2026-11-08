import {IsBoolean, IsOptional, IsString, MinLength} from 'class-validator';

export class UpdateMessageDto {
  @IsString()
  @MinLength(1)
  content: string;

  @IsOptional()
  @IsBoolean()
  acceptModerationWarning?: boolean;
}
