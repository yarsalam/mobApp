import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateReportDto {
  @IsNumber()
  reporterId: number;

  @IsNumber()
  reportedUserId: number;

  @IsEnum(['abuse', 'spam', 'fake', 'inappropriate_message', 'other'])
  reason: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  messageId?: string;

  @IsOptional()
  blockUser?: boolean; // اگر true باشه بلاک هم انجام بشه
}
