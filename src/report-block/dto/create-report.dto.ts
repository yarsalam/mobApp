import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReportDto {
  /*
   * این فیلد ممکن است از کلاینت قدیمی ارسال شود؛
   * کنترلر مقدار نهایی آن را از JWT جایگزین می‌کند.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  reporterId?: number;

  @IsInt()
  @Min(1)
  reportedUserId: number;

  @IsIn(['abuse', 'spam', 'fake', 'inappropriate_message', 'other'])
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  messageId?: string;

  @IsOptional()
  @IsBoolean()
  blockUser?: boolean;
}
