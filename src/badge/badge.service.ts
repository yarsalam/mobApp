import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/notification/notification.service';
import { MessageService } from 'src/message/message.service';

@Injectable()
export class BadgeService {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly messageService: MessageService,
  ) {}

  async getBadges(userId: number) {
    const [messages, interactions, system] = await Promise.all([
      this.messageService.getTotalUnreadCount(userId),
      this.notificationService.getInteractionCount(userId),
      this.notificationService.getSystemCount(userId),
    ]);
    return { messages, interactions, system };
  }
}
