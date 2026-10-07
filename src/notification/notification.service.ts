import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, In, Repository } from 'typeorm';
import {
  AppNotification,
  NotificationType,
} from './entities/notification.entity';
import { NotificationOrchestrator } from './orchestrator.notification';
import { UserPushState } from './entities/user-push-state.entity';
import {
  INTERACTION_TYPES,
  SYSTEM_TYPES,
} from './entities/notification.entity';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(AppNotification)
    private readonly notifRepo: Repository<AppNotification>,

    @InjectRepository(UserPushState)
    private readonly pushStateRepo: Repository<UserPushState>,

    private readonly orchestrator: NotificationOrchestrator,
  ) {}

  async createNotification(data: {
    user_id: number;
    type: NotificationType;
    message: string;
    related_id?: number;
  }) {
    const notif = this.notifRepo.create({
      ...data,
      type: data.type,
    });
    await this.notifRepo.save(notif);
    // dispatch به صورت fire-and-forget — ساخت notif را کند نمی‌کند
    this.orchestrator.dispatch(notif).catch(() => {});
    return notif;
  }

  async getUserNotifications(userId: number) {
    return this.notifRepo.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  async markAsRead(notificationId: number, userId: number) {
    const result = await this.notifRepo.update(
      {
        id: notificationId,
        user_id: userId,
      },
      {
        is_read: true,
      },
    );

    if (!result.affected) {
      throw new ForbiddenException();
    }

    return {
      success: true,
    };
  }

  async countUnread(userId: number) {
    return this.notifRepo.count({
      where: { user_id: userId, is_read: false },
    });
  }

  async getPendingCount(userId: number) {
    const state = await this.pushStateRepo.findOne({
      where: { user_id: userId },
    });

    const where: any = { user_id: userId, is_read: false };

    if (state?.last_push_sent_at) {
      where.created_at = MoreThan(state.last_push_sent_at);
    }

    const count = await this.notifRepo.count({ where });

    if (count > 0) {
      await this.pushStateRepo.upsert(
        { user_id: userId, last_push_sent_at: new Date() },
        ['user_id'],
      );
    }

    return { hasUnread: count > 0, count };
  }

  async getInteractions(userId: number) {
    return this.notifRepo.find({
      where: { user_id: userId, type: In(INTERACTION_TYPES) },
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  async getSystemNotifications(userId: number) {
    return this.notifRepo.find({
      where: { user_id: userId, type: In(SYSTEM_TYPES) },
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  async getInteractionCount(userId: number) {
    return this.notifRepo.count({
      where: { user_id: userId, type: In(INTERACTION_TYPES), is_read: false },
    });
  }

  async getSystemCount(userId: number) {
    return this.notifRepo.count({
      where: { user_id: userId, type: In(SYSTEM_TYPES), is_read: false },
    });
  }

  async markAllRead(userId: number, types: NotificationType[]) {
    await this.notifRepo.update(
      { user_id: userId, type: In(types), is_read: false },
      { is_read: true },
    );
  }
}
