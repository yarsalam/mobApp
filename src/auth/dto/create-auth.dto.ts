import {
  IsString,
  IsNotEmpty,
  Matches,
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AcquisitionMetadataDto {
  @IsOptional()
  @IsString()
  referralCode?: string | null;

  @IsOptional()
  @IsString()
  campaign?: string;

  @IsOptional()
  @IsString()
  medium?: string;

  @IsOptional()
  @IsString()
  landingPage?: string;

  @IsOptional()
  @IsString()
  referrer?: string;
}

export class CreateAuthDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^(09|\u06F0\u06F9)[0-9\u06F0-\u06F9]{9}$/, {
    message: 'شماره موبایل معتبر نیست',
  })
  phone!: string;

  @IsString()
  @IsNotEmpty()
  gender!: string;

  @IsString()
  @IsIn(['web', 'mobile'])
  platform!: 'web' | 'mobile';

  @IsOptional()
  @IsString()
  acquisitionSource?: string;

  @IsOptional()
  @IsString()
  acquisitionKeyword?: string;

  @IsOptional()
  @IsString()
  recaptchaToken?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AcquisitionMetadataDto)
  metadata?: AcquisitionMetadataDto;
}
