import {
  IsOptional,
  IsString,
  IsNumber,
  IsIn,
  IsBoolean,
  MaxLength,
} from 'class-validator';

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
  @IsBoolean()
  isVpn?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  pushToken?: string;

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;
}
