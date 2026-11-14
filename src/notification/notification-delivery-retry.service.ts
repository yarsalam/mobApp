import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Inject } from '@nestjs/common';
import { MoreThan, Repository } from 'typeorm';
import { Redis } from 'ioredis';
import { AppNotification } from './entities/notification.entity';
import { NotificationGateway } from './notification.gateway';
import { NotificationOrchestrator } from './orchestrator.notification';
import { PushChannel } from './channels/push.channel';
import { REDIS_CLIENT } from 'src/redis/redis.constants';

@Injectable()
export class NotificationDeliveryRetryService {
  private readonly logger = new Logger(NotificationDeliveryRetryService.name);
  private readonly lockKey = 'lock:notification-undelivered-retry';

  constructor(
    @InjectRepository(AppNotification)
    private readonly notificationRepo: Repository<AppNotification>,
    private readonly gateway: NotificationGateway,
    private readonly orchestrator: NotificationOrchestrator,
    private readonly pushChannel: PushChannel,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  @Cron('*/5 * * * *')
  async retryUndelivered(): Promise<void> {
    // Realtime delivery was already attempted at create time. Offline delivery
    // retries require a configured FCM sender and at least one eligible device.
    if (!this.pushChannel.isConfigured()) return;

    const locked = await this.redis.set(
      this.lockKey,
      '1',
      'EX',
      4 * 60,
      'NX',
    );
    if (locked !== 'OK') return;

    try {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const pending = await this.notificationRepo.find({
        where: {
          delivered: false,
          created_at: MoreThan(cutoff),
        },
        order: { created_at: 'ASC' },
        take: 100,
      });

      let attempted = 0;
      for (const notification of pending) {
        if (!this.gateway.isOnline(notification.user_id)) {
          const hasDevice = await this.pushChannel.hasEnabledDevice(
            notification.user_id,
          );
          if (!hasDevice) continue;
        }

        attempted += 1;
        await this.orchestrator.dispatch(notification);
      }

      if (attempted > 0) {
        this.logger.log(
          `Retried delivery for ${attempted} persisted unread notifications`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Notification retry scan failed: ${message}`);
    } finally {
      // This is a short-lived distributed scheduling lock, not a delivery
      // receipt. It expires even if the worker process dies.
      await this.redis.del(this.lockKey).catch(() => undefined);
    }
  }
}
