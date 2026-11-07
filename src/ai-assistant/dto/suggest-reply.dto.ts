import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SuggestReplyDto {
  // Legacy assistant-conversation identifier; retained for backward compatibility.
  @IsOptional()
  @IsInt()
  @Min(1)
  convId?: number;

  // Real user-to-user chat target. The requester identity always comes from JWT.
  @IsOptional()
  @IsInt()
  @Min(1)
  targetUserId?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message: string;
}
