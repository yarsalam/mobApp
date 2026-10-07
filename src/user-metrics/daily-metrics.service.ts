import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';

@Injectable()
export class DailyMetricsService {
  private readonly logger = new Logger(DailyMetricsService.name);

  constructor(
    @InjectEntityManager()
    private readonly entityManager: EntityManager,
  ) {}

  @Cron('0 3 * * *') // هر شب ساعت ۳ صبح
  async updateDailyMetrics() {
    this.logger.log('Starting daily metrics update...');

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

    // FIX: به جای DATE(createdAt) = ? از range استفاده می‌کنیم
    // تا MySQL بتواند از index روی createdAt استفاده کند
    const dayStart = `${dateStr} 00:00:00`;
    const dayEnd = `${dateStr} 23:59:59`;

    try {
      await this.entityManager.query(
        `
        INSERT INTO user_daily_metrics (
          userId,
          metricDate,
          appOpens,
          messagesSent,
          profileViews,
          likes,
          matches,
          boostUsed,
          purchases
        )
        SELECT
          userId,
          DATE(createdAt)                                                      AS metricDate,
          SUM(CASE WHEN type IN ('login', 'app_open') THEN 1 ELSE 0 END)     AS appOpens,
          SUM(CASE WHEN type = 'message_sent'         THEN 1 ELSE 0 END)     AS messagesSent,
          SUM(CASE WHEN type = 'profile_view'         THEN 1 ELSE 0 END)     AS profileViews,
          SUM(CASE WHEN type = 'like'                 THEN 1 ELSE 0 END)     AS likes,
          SUM(CASE WHEN type = 'match'                THEN 1 ELSE 0 END)     AS matches,
          SUM(CASE WHEN type = 'boost_used'           THEN 1 ELSE 0 END)     AS boostUsed,
          SUM(CASE WHEN type = 'purchase'             THEN 1 ELSE 0 END)     AS purchases
        FROM user_events
        WHERE createdAt >= ?
          AND createdAt <= ?
        GROUP BY userId, DATE(createdAt)

        ON DUPLICATE KEY UPDATE
          appOpens     = VALUES(appOpens),
          messagesSent = VALUES(messagesSent),
          profileViews = VALUES(profileViews),
          likes        = VALUES(likes),
          matches      = VALUES(matches),
          boostUsed    = VALUES(boostUsed),
          purchases    = VALUES(purchases)
        `,
        [dayStart, dayEnd],
      );

      this.logger.log(`Daily metrics updated for ${dateStr}`);
    } catch (err: unknown) {
      this.logger.error('Failed to update daily metrics', err);
    }
  }
}
