import {
  IsNumber,
  IsOptional,
  IsString,
  IsObject,
  IsBoolean,
} from 'class-validator';
import { FeedbackValue, FeedbackContext } from '../entities/ai-feedback.entity';

export class CreateAiFeedbackDto {
  @IsNumber()
  userId: number;

  @IsString()
  feature: string;

  @IsOptional()
  @IsNumber()
  phase?: number;

  @IsOptional()
  @IsString()
  feedbackType?: string;

  @IsOptional()
  @IsNumber()
  impactScore?: number;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsObject()
  value?: FeedbackValue;

  @IsOptional()
  @IsObject()
  context?: FeedbackContext;

  @IsOptional()
  @IsBoolean()
  convertedToPurchase?: boolean;
}
