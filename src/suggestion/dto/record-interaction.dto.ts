import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsInt, IsObject } from 'class-validator';

export enum InteractionType {
  VIEW = 'view',
  LIKE = 'like',
  SUPERLIKE = 'superlike',
  SKIP = 'skip',
  MESSAGE = 'message',
  MATCH = 'match',
}

export interface InteractionMetadata {
  source?: string; // مثلا از پیشنهاد یا سرچ
  messageId?: string;
  context?: Record<string, unknown>;
}

export class RecordInteractionDto {
  @ApiProperty({ description: 'شناسه کاربر هدف' })
  @IsInt()
  targetUserId: number;

  @ApiProperty({ enum: InteractionType, description: 'نوع تعامل' })
  @IsEnum(InteractionType)
  type: InteractionType;

  @ApiPropertyOptional({ description: 'اطلاعات متادیتا', type: Object })
  @IsOptional()
  @IsObject()
  metadata?: InteractionMetadata;
}
