import { IsOptional, IsString, IsNumber, IsIn } from 'class-validator';

export class CreateUserDeviceDto {
  @IsNumber()
  userId: number;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;

  @IsOptional()
  @IsIn(['web', 'mobile'])
  platform?: 'web' | 'mobile';

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  osVersion?: string;

  @IsOptional()
  @IsString()
  appVersion?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  isVpn?: boolean;

  @IsOptional()
  @IsString()
  deviceId?: string;
}
