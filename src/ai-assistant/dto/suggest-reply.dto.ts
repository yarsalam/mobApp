import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class SuggestReplyDto {
  @IsInt()
  @Min(1)
  convId: number;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message: string;
}
