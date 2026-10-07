import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

@Injectable()
export class NotificationProducer {
  constructor(
    // رفع: نام صحیح queue
    @InjectQueue('notifications') private queue: Queue,
  ) {}

  async enqueue(notif: any) {
    return this.queue.add('dispatch', notif);
  }
}
