import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron } from '@nestjs/schedule';

import { PartitionedEvent } from './entities/partitioned-event.entity';
import { LogEventDto } from './dto/log-event.dto';
import { EventType } from 'src/user-event/type/event-type.enum';

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
  ) {}

  async log(eventData: LogEventDto): Promise<void> {
    if (!eventData.userId) {
      throw new Error('USER ID MISSING');
    }

    const result = await this.eventRepo
      .createQueryBuilder()
      .insert()
      .into(PartitionedEvent)
      .values({
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
      })
      .execute();

    const insertedId = Number(result.identifiers[0]?.id);

    if (!insertedId) {
      throw new Error(`EVENT INSERT FAILED for user ${eventData.userId}`);
    }

    await this.ingestionQueue.add(
      'process',
      {
        eventId: insertedId,
        userId: eventData.userId,
        type: eventData.type,
      },
      {
        jobId: `event-${insertedId}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );

    this.logger.debug(
      `Event ${insertedId} queued: ${eventData.type} user=${eventData.userId}`,
    );
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
