import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsString, IsBoolean } from 'class-validator';

export class GetSuggestionsQueryDto {
  @ApiPropertyOptional({ description: 'تعداد نتایج پیشنهادی' })
  @IsOptional()
  @IsNumber()
  limit?: number;

  @ApiPropertyOptional({ description: 'حداقل سن' })
  @IsOptional()
  @IsNumber()
  ageFrom?: number;

  @ApiPropertyOptional({ description: 'حداکثر سن' })
  @IsOptional()
  @IsNumber()
  ageTo?: number;

  @ApiPropertyOptional({ description: 'شهر مورد نظر' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'فقط کاربران آنلاین' })
  @IsOptional()
  @IsBoolean()
  onlyOnline?: boolean;
}
