import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron } from '@nestjs/schedule';

import { PartitionedEvent } from './entities/partitioned-event.entity';
import { LogEventDto } from './dto/log-event.dto';
import { EventType } from 'src/user-event/type/event-type.enum';
import { DataSource } from 'typeorm';
import { EventOutbox } from './entities/event-outbox.entity';

@Injectable()
export class UserEventService {
  private readonly logger = new Logger(UserEventService.name);

  constructor(
    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,

    @InjectQueue('event-ingestion')
    private readonly ingestionQueue: Queue,

    @InjectQueue('event-aggregation')
    private readonly aggregationQueue: Queue,

    @InjectQueue('cohort-calculation')
    private readonly cohortQueue: Queue,

    private readonly dataSource: DataSource,
  ) {}

  async log(eventData: LogEventDto): Promise<void> {
    if (!Number.isSafeInteger(eventData.userId) || eventData.userId <= 0) {
      throw new Error('Invalid userId');
    }

    if (!eventData.type) {
      throw new Error('Event type is required');
    }

    const key = eventData.idempotencyKey?.trim();

    if (key && key.length > 128) {
      throw new Error('idempotencyKey must not exceed 128 characters');
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        const events = manager.getRepository(PartitionedEvent);
        const outbox = manager.getRepository(EventOutbox);

        if (key) {
          const existing = await events.findOne({
            where: {
              userId: eventData.userId,
              idempotencyKey: key,
            },
          });

          if (existing) {
            // در حالت عادی Outbox در همان تراکنش ثبت شده است.
            // این بررسی برای بازیابی رکوردهای قدیمی/ناسازگار است.
            const outboxExists = await outbox.findOne({
              where: { eventId: existing.id },
            });

            if (!outboxExists) {
              await outbox.save(
                outbox.create({
                  eventId: existing.id,
                  userId: existing.userId,
                  type: existing.type,
                  status: 'pending',
                }),
              );
            }

            return;
          }
        }

        const event = await events.save(
          events.create({
            userId: eventData.userId,
            targetUserId: eventData.targetUserId ?? undefined,
            type: eventData.type,
            sessionId: eventData.sessionId,
            metadata: eventData.metadata,
            value: eventData.value,
            currency: eventData.currency,
            duration: eventData.duration,
            platform: eventData.platform,
            country: eventData.country,
            idempotencyKey: key || null,
          }),
        );

        await outbox.save(
          outbox.create({
            eventId: event.id,
            userId: event.userId,
            type: event.type,
            status: 'pending',
          }),
        );
      });
    } catch (error: unknown) {
      // دو درخواست هم‌زمان ممکن است به Unique Index برخورد کنند.
      // در این حالت، اگر رکورد موجود است، عملیات از دید Producer موفق است.
      const err = error as {
        code?: string;
        errno?: number;
      };

      if (key && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
        const existing = await this.eventRepo.findOne({
          where: {
            userId: eventData.userId,
            idempotencyKey: key,
          },
        });

        if (existing) {
          return;
        }
      }

      throw error;
    }
  }

  @Cron('0 1 * * *')
  async aggregateDaily(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const dateStr = yesterday.toISOString().split('T')[0];

    await this.aggregationQueue.add(
      'aggregate-daily',
      {
        date: dateStr,
      },
      {
        jobId: `aggregate-${dateStr}`,
        removeOnComplete: 30,
        removeOnFail: 100,
      },
    );
  }

  @Cron('0 2 * * 0')
  async calculateCohorts(): Promise<void> {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);

    const dateStr = lastWeek.toISOString().split('T')[0];

    await this.cohortQueue.add(
      'calculate-cohort',
      {
        cohortDate: dateStr,
      },
      {
        jobId: `cohort-${dateStr}`,
        removeOnComplete: 30,
        removeOnFail: 100,
      },
    );
  }

  async getUserStats(userId: number): Promise<{
    totalEvents: number;
    activeDays: number;
    breakdown: Array<{
      type: EventType;
      count: number;
    }>;
    avgLTV: number;
    purchaseRate: number;
    responseRate: number;
    matchRate: number;
  }> {
    // این متد فعلاً برای backward compatibility نگه داشته شده.
    // منطق canonical در UserMetricsService قرار دارد.
    return {
      totalEvents: 0,
      activeDays: 0,
      breakdown: [],
      avgLTV: 0,
      purchaseRate: 0,
      responseRate: 0,
      matchRate: 0,
    };
  }

  async getUserEvents(
    userId: number,
    options?: { limit?: number },
  ): Promise<PartitionedEvent[]> {
    return this.eventRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: options?.limit ?? 50,
    });
  }

  async findReportEvent(
    userId: number,
    messageId: number,
  ): Promise<PartitionedEvent | null> {
    return this.eventRepo
      .createQueryBuilder('event')
      .where('event.userId = :userId', { userId })
      .andWhere('event.type = :type', {
        type: EventType.MESSAGE_REPORTED,
      })
      .andWhere(
        "JSON_UNQUOTE(JSON_EXTRACT(event.metadata, '$.messageId')) = :messageId",
        {
          messageId: String(messageId),
        },
      )
      .getOne();
  }
}
