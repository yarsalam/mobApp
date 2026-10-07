import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  Length,
} from 'class-validator';
import { TicketCategory } from '../entities/ticket.entity';

export class CreateTicketDto {
  @IsString()
  @Length(5, 200)
  title: string;

  @IsString()
  @Length(10, 5000)
  description: string;

  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @IsOptional()
  @IsObject()
  metadata?: {
    userAgent?: string;
    platform?: string;
    appVersion?: string;
    screenShots?: string[];
  };
}
