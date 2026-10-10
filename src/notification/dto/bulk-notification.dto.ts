import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { NotificationType } from '../entities/notification.entity';

export class BulkNotificationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  userIds: number[];

  @IsEnum(NotificationType)
  type: NotificationType;

  @IsString()
  @MaxLength(500)
  message: string;
}
