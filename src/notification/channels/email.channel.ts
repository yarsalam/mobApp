import { Injectable } from '@nestjs/common';
import { AppNotification } from '../entities/notification.entity';

@Injectable()
export class EmailChannel {
  async send(notif: AppNotification): Promise<boolean> {
    // TODO: call ippanel api
    return true;
  }
}
