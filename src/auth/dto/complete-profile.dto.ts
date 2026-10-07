import {
  IsString,
  ValidateNested,
  IsNotEmpty,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

class BirthDateDto {
  @IsString()
  @IsNotEmpty()
  day: string;

  @IsString()
  @IsNotEmpty()
  month: string;

  @IsString()
  @IsNotEmpty()
  year: string;
}

export class CompleteProfileDto {
  // Step 1
  @IsString()
  nickname: string;

  @ValidateNested()
  @Type(() => BirthDateDto)
  birthDate: BirthDateDto;

  @IsString()
  marital: string;

  @IsString()
  province: string;

  @IsString()
  city: string;

  @IsString()
  nationality: string;

  // Step 2
  @IsString()
  employment: string;

  @IsString()
  education: string;

  @IsString()
  weight: string;

  @IsString()
  height: string;

  @IsString()
  religion: string;

  @IsString()
  health: string;

  // Step 3 — درباره همسر ایده‌آل
  @IsArray()
  @ArrayMinSize(1, { message: 'حداقل یک ارزش باید انتخاب شود' })
  @ArrayMaxSize(3, { message: 'حداکثر ۳ ارزش می‌توانید انتخاب کنید' })
  values_partner: string[];

  @IsString()
  partner_about: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'حداقل یک سبک زندگی باید انتخاب شود' })
  @ArrayMaxSize(5, { message: 'حداکثر ۵ سبک زندگی می‌توانید انتخاب کنید' })
  hobbies_partner: string[];

  // Step 4 — درباره من
  @IsString()
  aboutme: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'حداقل یک ارزش باید انتخاب شود' })
  @ArrayMaxSize(3, { message: 'حداکثر ۳ ارزش می‌توانید انتخاب کنید' })
  values_self: string[];

  @IsArray()
  @ArrayMinSize(1, { message: 'حداقل یک سبک زندگی باید انتخاب شود' })
  @ArrayMaxSize(5, { message: 'حداکثر ۵ سبک زندگی می‌توانید انتخاب کنید' })
  hobbies_self: string[];

  @IsOptional()
  @IsString()
  acquisitionSource?: string;

  @IsOptional()
  @IsString()
  password?: string;
}
