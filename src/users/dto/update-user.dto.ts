import { IsString, IsOptional, IsArray, IsBoolean } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsOptional() @IsString() nickname?: string;
  @IsOptional() @IsString() birth_day?: string;
  @IsOptional() @IsString() birth_month?: string;
  @IsOptional() @IsString() birth_year?: string;
  @IsOptional() @IsString() marital?: string;
  @IsOptional() @IsString() province?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() education?: string;
  @IsOptional() @IsString() employment?: string;
  @IsOptional() @IsString() height?: string;
  @IsOptional() @IsString() weight?: string;
  @IsOptional() @IsString() religion?: string;
  @IsOptional() @IsString() health?: string;
  @IsOptional() @IsString() acquisitionSource?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) values_partner?: string[];
  @IsOptional() @IsString() partner_about?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) hobbies_partner?: string[];
  @IsOptional() @IsString() aboutme?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) values_self?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) hobbies_self?: string[];
  @IsOptional() @IsBoolean() isCompleted?: boolean;
}
