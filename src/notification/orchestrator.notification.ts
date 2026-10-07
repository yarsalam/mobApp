import { Injectable } from '@nestjs/common';
import { NotificationGateway } from './notification.gateway';
import { AppNotification } from './entities/notification.entity';

@Injectable()
export class NotificationOrchestrator {
  constructor(private readonly gateway: NotificationGateway) {}

  async dispatch(notif: AppNotification): Promise<void> {
    // فعلاً فقط realtime داخل اپ
    this.gateway.send(notif.user_id, {
      id: notif.id,
      type: notif.type,
      message: notif.message,
      related_id: notif.related_id,
      created_at: notif.created_at,
      is_read: notif.is_read,
    });

    // TODO: فاز ۲ — push, telegram, sms با preference و cooldown
  }
}
