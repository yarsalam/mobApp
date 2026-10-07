import { Injectable } from '@nestjs/common';
import { AppNotification } from '../entities/notification.entity';

@Injectable()
export class PushChannel {
  async send(notif: AppNotification): Promise<boolean> {
    // TODO: call /firebase-proxy
    return true; // mock
  }
}
