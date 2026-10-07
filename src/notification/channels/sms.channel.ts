import { Injectable } from '@nestjs/common';
import { AppNotification } from '../entities/notification.entity';

@Injectable()
export class SmsChannel {
  async send(notif: AppNotification): Promise<boolean> {
    // TODO: call ippanel api
    return true;
  }
}
