import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ACQUISITION_COST_CATEGORIES,
  ACQUISITION_COST_CURRENCIES,
} from '../entities/acquisition-cost.entity';

export class CreateAcquisitionCostDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  source!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  medium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  campaign?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  campaignId?: string;

  @IsEnum(ACQUISITION_COST_CATEGORIES)
  category!: (typeof ACQUISITION_COST_CATEGORIES)[number];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000_000)
  amount!: number;

  @IsEnum(ACQUISITION_COST_CURRENCIES)
  currency!: (typeof ACQUISITION_COST_CURRENCIES)[number];

  @IsDateString()
  occurredAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  createdBy?: string;
}
