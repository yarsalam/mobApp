import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { EventOutbox } from '../entities/event-outbox.entity';

@Injectable()
export class EventOutboxDispatcher {
  private readonly logger = new Logger(EventOutboxDispatcher.name);
  private running = false;

  constructor(
    @InjectRepository(EventOutbox)
    private readonly outboxRepo: Repository<EventOutbox>,

    @InjectQueue('event-ingestion')
    private readonly ingestionQueue: Queue,
  ) {}

  @Cron('*/5 * * * * *')
  async dispatchPending(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const pending = await this.outboxRepo.find({
        where: { status: 'pending' },
        order: { id: 'ASC' },
        take: 100,
      });

      for (const item of pending) {
        try {
          await this.ingestionQueue.add(
            'process',
            {
              eventId: item.eventId,
              userId: item.userId,
              type: item.type,
            },
            {
              // شناسهٔ قطعی برای جلوگیری از Job تکراری
              // تا زمانی که Job قبلی در BullMQ نگهداری می‌شود.
              jobId: `event-${item.eventId}`,
              attempts: 8,
              backoff: {
                type: 'exponential',
                delay: 1000,
              },
              removeOnComplete: 1000,
              removeOnFail: 5000,
            },
          );

          await this.outboxRepo.update(
            { id: item.id, status: 'pending' },
            {
              status: 'dispatched',
              dispatchedAt: new Date(),
              lastError: null,
            },
          );
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);

          await this.outboxRepo.increment({ id: item.id }, 'attempts', 1);

          await this.outboxRepo.update(
            { id: item.id },
            { lastError: message.slice(0, 4000) },
          );

          this.logger.error(
            `Outbox dispatch failed for event=${item.eventId}: ${message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
