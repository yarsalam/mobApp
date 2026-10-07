import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from './notification.service';
import { NotificationType } from './entities/notification.entity';

@Injectable()
export class NotificationListener {
  constructor(private readonly notificationService: NotificationService) {}

  @OnEvent('user.liked')
  handleUserLiked(payload: {
    likerId: number;
    likerName: string;
    targetUserId: number;
  }) {
    void this.notificationService.createNotification({
      user_id: payload.targetUserId,
      type: NotificationType.LIKE,
      message: `${payload.likerName} پروفایل شما را پسندید ❤️`,
      related_id: payload.likerId,
    });
  }

  @OnEvent('user.superliked')
  handleUserSuperLiked(payload: {
    likerId: number;
    likerName: string;
    targetUserId: number;
  }) {
    void this.notificationService.createNotification({
      user_id: payload.targetUserId,
      type: NotificationType.SUPERLIKE,
      message: `${payload.likerName} به شما سوپرلایک داد ⭐`,
      related_id: payload.likerId,
    });
  }

  @OnEvent('user.visited')
  handleUserVisited(payload: {
    visitorId: number;
    visitorName: string;
    targetUserId: number;
  }) {
    void this.notificationService.createNotification({
      user_id: payload.targetUserId,
      type: NotificationType.VISITOR,
      message: `${payload.visitorName} از پروفایل شما بازدید کرد 👀`,
      related_id: payload.visitorId,
    });
  }

  @OnEvent('user.matched')
  handleUserMatched(payload: {
    userId: number;
    userName: string;
    targetUserId: number;
  }) {
    void this.notificationService.createNotification({
      user_id: payload.targetUserId,
      type: NotificationType.MATCH,
      message: `شما با ${payload.userName} مچ شدید 🎉`,
      related_id: payload.userId,
    });
  }

  @OnEvent('system.announcement')
  handleSystemAnnouncement(payload: {
    message: string;
    targetUserId?: number;
  }) {
    if (payload.targetUserId) {
      void this.notificationService.createNotification({
        user_id: payload.targetUserId,
        type: NotificationType.SYSTEM,
        message: payload.message,
      });
    }
  }
}
