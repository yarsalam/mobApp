import { Injectable } from '@nestjs/common';
import { AppNotification } from '../entities/notification.entity';

@Injectable()
export class TelegramChannel {
  async send(notif: AppNotification): Promise<boolean> {
    // TODO: call bot api
    return false; // mock fallback
  }
}
