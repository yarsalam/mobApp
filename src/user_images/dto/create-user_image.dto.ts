import { IsString, IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class CreateUserImageDto {
  @IsString()
  filename: string; // نام فایل

  @IsString()
  path: string; // مسیر تصویر

  @IsString()
  url: string; // URL برای دسترسی به تصویر

  @IsBoolean()
  approved: boolean; // تایید تصویر

  @IsNumber()
  user_id: number; // شناسه کاربر

  @IsBoolean()
  isMain: boolean; // تایید تصویر

  @IsOptional()
  @IsString()
  thumbnailPath?: string; // برای ذخیره مسیر پیش‌نمایش یا اندازه‌های کوچک
}
