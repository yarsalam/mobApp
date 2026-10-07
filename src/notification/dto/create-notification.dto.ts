import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { NotificationType } from '../entities/notification.entity';

export enum NotificationSource {
  AI = 'ai',
  SYSTEM = 'system',
  USER = 'user',
}

export class CreateNotificationDto {
  @IsInt()
  user_id: number;

  @IsEnum(NotificationType)
  type: NotificationType;

  @IsString()
  message: string;

  @IsOptional()
  @IsInt()
  related_id?: number;

  @IsOptional()
  @IsEnum(NotificationSource)
  source?: NotificationSource;
}
