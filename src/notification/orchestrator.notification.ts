import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationGateway } from './notification.gateway';
import { AppNotification } from './entities/notification.entity';
import { PushChannel } from './channels/push.channel';
import { UserPushState } from './entities/user-push-state.entity';

@Injectable()
export class NotificationOrchestrator {
  private readonly logger = new Logger(NotificationOrchestrator.name);

  constructor(
    private readonly gateway: NotificationGateway,
    private readonly pushChannel: PushChannel,
    @InjectRepository(AppNotification)
    private readonly notificationRepo: Repository<AppNotification>,
    @InjectRepository(UserPushState)
    private readonly pushStateRepo: Repository<UserPushState>,
  ) {}

  async dispatch(notif: AppNotification): Promise<void> {
    const payload = {
      id: notif.id,
      type: notif.type,
      message: notif.message,
      related_id: notif.related_id,
      created_at: notif.created_at,
      is_read: notif.is_read,
      screen: 'Notifications',
    };

    try {
      let delivered = false;
      if (this.gateway.isOnline(notif.user_id)) {
        this.gateway.send(notif.user_id, payload);
        delivered = true;
      } else {
        delivered = await this.pushChannel.send(notif);
      }

      if (delivered) {
        const sentAt = new Date();
        await Promise.all([
          this.notificationRepo.update(notif.id, {
            delivered: true,
            last_push_sent_at: sentAt,
          }),
          this.pushStateRepo.upsert(
            { user_id: notif.user_id, last_push_sent_at: sentAt },
            ['user_id'],
          ),
        ]);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // Keep the notification unread so the mobile polling fallback can surface it.
      this.logger.warn(
        `Notification delivery failed for notification ${notif.id}: ${message}`,
      );
    }
  }
}
