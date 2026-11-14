import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationGateway } from './notification.gateway';
import { AppNotification } from './entities/notification.entity';

@Injectable()
export class NotificationOrchestrator {
  private readonly logger = new Logger(NotificationOrchestrator.name);

  constructor(
    private readonly gateway: NotificationGateway,
    @InjectRepository(AppNotification)
    private readonly notificationRepo: Repository<AppNotification>,
  ) {}

  async dispatch(notification: AppNotification): Promise<void> {
    // Never attempt remote delivery. Socket.IO is the only realtime channel;
    // the database-backed inbox is the offline delivery queue.
    if (!this.gateway.isOnline(notification.user_id)) return;

    const payload = {
      id: notification.id,
      type: notification.type,
      message: notification.message,
      related_id: notification.related_id,
      created_at: notification.created_at,
      is_read: notification.is_read,
      screen: 'Notifications',
    };

    try {
      this.gateway.send(notification.user_id, payload);
      await this.notificationRepo.update(notification.id, { delivered: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Socket delivery failed for notification ${notification.id}: ${message}`,
      );
      // The row stays persisted and unread; the client will fetch it on reconnect.
    }
  }
}
