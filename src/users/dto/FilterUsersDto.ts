import {
  IsOptional,
  IsString,
  IsArray,
  IsNumberString,
  IsBoolean,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class FilterUsersDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  marital?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  province?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  city?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  nationality?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  education?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  employment?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  health?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  religion?: string[];

  @IsOptional() @IsNumberString() minHeight?: string;
  @IsOptional() @IsNumberString() maxHeight?: string;
  @IsOptional() @IsNumberString() minWeight?: string;
  @IsOptional() @IsNumberString() maxWeight?: string;
  @IsOptional() @IsNumberString() minAge?: string;
  @IsOptional() @IsNumberString() maxAge?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  hasPhoto?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  verifiedOnly?: boolean;
}
