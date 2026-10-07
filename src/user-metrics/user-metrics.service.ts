import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Payment } from 'src/payments/entities/payment.entity';
import { Between, EntityManager, MoreThan, Repository } from 'typeorm';

import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class UserMetricsService {
  constructor(
    @InjectRepository(PartitionedEvent)
    private readonly activityRepo: Repository<PartitionedEvent>,

    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,

    private readonly entityManager: EntityManager,
  ) {}

  async get7dMetrics(userId: number) {
    // ستون‌های جدول user_daily_metrics به صورت camelCase هستند
    const result = await this.entityManager.query(
      `
      SELECT
        COALESCE(SUM(appOpens),      0) AS app_opens,
        COALESCE(SUM(messagesSent),  0) AS messages7d,
        COALESCE(SUM(profileViews),  0) AS views7d,
        COALESCE(SUM(likes),         0) AS likes7d,
        COALESCE(SUM(matches),       0) AS matches7d,
        COALESCE(SUM(boostUsed),     0) AS boostUsed7d,
        COALESCE(SUM(purchases),     0) AS purchases7d
      FROM user_daily_metrics
      WHERE userId = ?
        AND metricDate >= CURDATE() - INTERVAL 7 DAY
      `,
      [userId],
    );

    return (
      result[0] || {
        app_opens: 0,
        messages7d: 0,
        views7d: 0,
        likes7d: 0,
        matches7d: 0,
        boostUsed7d: 0,
        purchases7d: 0,
      }
    );
  }

  async getRetentionDays(userId: number): Promise<number> {
    const result = await this.entityManager.query(
      `
      SELECT COUNT(*) AS retention_count
      FROM user_daily_metrics
      WHERE userId = ?
        AND appOpens > 0
        AND metricDate >= CURDATE() - INTERVAL 7 DAY
      `,
      [userId],
    );

    return Number(result[0]?.retention_count || 0);
  }

  async getBoostUsed7d(userId: number): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.activityRepo.count({
      where: {
        userId,
        type: EventType.BOOST_USED,
        createdAt: MoreThan(sevenDaysAgo),
      },
    });
  }

  async getMessagesSent7d(userId: number): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.activityRepo.count({
      where: {
        userId,
        type: EventType.MESSAGE_SENT,
        createdAt: MoreThan(sevenDaysAgo),
      },
    });
  }

  async getProfileViews7d(userId: number): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.activityRepo.count({
      where: {
        targetUserId: userId,
        type: EventType.PROFILE_VIEW,
        createdAt: MoreThan(sevenDaysAgo),
      },
    });
  }

  async getPastPayments(userId: number): Promise<number> {
    return this.paymentRepo.count({
      where: { userId, status: 'paid' },
    });
  }

  async buildExtraMetrics(userId: number) {
    const [retentionDays, boostUsed7d, pastPayments, messages7d, views7d] =
      await Promise.all([
        this.getRetentionDays(userId),
        this.getBoostUsed7d(userId),
        this.getPastPayments(userId),
        this.getMessagesSent7d(userId),
        this.getProfileViews7d(userId),
      ]);

    return { retentionDays, boostUsed7d, pastPayments, messages7d, views7d };
  }

  async getEngagementSlope(userId: number): Promise<number> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);

    const [recent, previous] = await Promise.all([
      this.activityRepo.count({
        where: { userId, createdAt: MoreThan(sevenDaysAgo) },
      }),
      this.activityRepo.count({
        where: {
          userId,
          createdAt: Between(fourteenDaysAgo, sevenDaysAgo),
        },
      }),
    ]);

    if (previous === 0) return recent > 0 ? 1 : 0.5;

    const ratio = recent / previous;
    return Math.min(Math.max(Math.round(ratio * 50) / 100, 0), 1);
  }
}
