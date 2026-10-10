import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class StartConversationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  initialMessage?: string;
}
