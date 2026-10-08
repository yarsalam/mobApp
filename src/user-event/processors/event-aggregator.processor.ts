import { Injectable, Logger } from '@nestjs/common';

import { Processor, WorkerHost } from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { InjectRepository } from '@nestjs/typeorm';

import { Repository, EntityManager } from 'typeorm';

import { PartitionedEvent } from '../entities/partitioned-event.entity';
import { DailyEventAggregate } from '../aggregates/daily-event-aggregate.entity';

interface EventAggregationJob {
  date: string;
}

@Processor('event-aggregation')
@Injectable()
export class EventAggregatorProcessor extends WorkerHost {
  private readonly logger = new Logger(EventAggregatorProcessor.name);

  constructor(
    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,

    @InjectRepository(DailyEventAggregate)
    private readonly aggregateRepo: Repository<DailyEventAggregate>,

    private readonly entityManager: EntityManager,
  ) {
    super();
  }

  async process(job: Job<EventAggregationJob>): Promise<{
    date: string;
    aggregated: number;
    duration?: number;
  }> {
    const { date } = job.data;

    const startTime = Date.now();

    this.logger.log(`Aggregating events for ${date}`);

    const results = await this.entityManager.query(
      `
      WITH base AS (
        SELECT
          type,
          userId,
          value,
          COALESCE(platform, 'unknown') AS platform,
          COALESCE(country, 'unknown') AS country
        FROM user_events
        WHERE createdAt >= ?
          AND createdAt < DATE_ADD(?, INTERVAL 1 DAY)
      ),

      summary AS (
        SELECT
          type,
          COUNT(*) AS total_count,
          COUNT(DISTINCT userId) AS unique_users,
          COALESCE(SUM(value), 0) AS total_value
        FROM base
        GROUP BY type
      ),

      platform_agg AS (
        SELECT
          type,
          JSON_OBJECTAGG(platform, cnt) AS by_platform
        FROM (
          SELECT
            type,
            platform,
            COUNT(*) AS cnt
          FROM base
          GROUP BY type, platform
        ) t
        GROUP BY type
      ),

      country_agg AS (
        SELECT
          type,
          JSON_OBJECTAGG(country, cnt) AS by_country
        FROM (
          SELECT
            type,
            country,
            COUNT(*) AS cnt
          FROM base
          GROUP BY type, country
        ) t
        GROUP BY type
      )

      SELECT
        s.type,
        s.total_count AS count,
        s.unique_users,
        s.total_value,

        COALESCE(
          pa.by_platform,
          JSON_OBJECT()
        ) AS by_platform,

        COALESCE(
          ca.by_country,
          JSON_OBJECT()
        ) AS by_country

      FROM summary s

      LEFT JOIN platform_agg pa
        ON pa.type = s.type

      LEFT JOIN country_agg ca
        ON ca.type = s.type
      `,
      [date, date],
    );

    if (!results.length) {
      this.logger.log(`No events for ${date}`);

      return {
        date,
        aggregated: 0,
      };
    }

    const aggregates = results.map(
      (row: {
        type: string;
        count: string | number;
        unique_users: string | number;
        total_value: string | number;
        by_platform: Record<string, number>;
        by_country: Record<string, number>;
      }) => ({
        date: new Date(date),
        eventType: row.type,
        totalCount: Number(row.count),
        uniqueUsers: Number(row.unique_users),
        totalValue: Number(row.total_value),
        byPlatform: row.by_platform ?? {},
        byCountry: row.by_country ?? {},
      }),
    );

    await this.entityManager
      .createQueryBuilder()
      .insert()
      .into(DailyEventAggregate)
      .values(aggregates)
      .orUpdate(
        ['totalCount', 'uniqueUsers', 'totalValue', 'byPlatform', 'byCountry'],
        ['date', 'eventType'],
      )
      .execute();

    const duration = Date.now() - startTime;

    this.logger.log(
      `Aggregated ${results.length} event types for ${date} in ${duration}ms`,
    );

    return {
      date,
      aggregated: results.length,
      duration,
    };
  }
}
