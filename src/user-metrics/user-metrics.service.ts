import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Payment } from 'src/payments/entities/payment.entity';
import { Between, EntityManager, MoreThan, Repository } from 'typeorm';

import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { EventType } from 'src/user-event/type/event-type.enum';

export interface UserIntelligenceMetrics {
  totalEvents: number;
  activeDays: number;

  likes: number;
  matches: number;

  messagesSent: number;
  messagesReceived: number;
  replies: number;

  purchases: number;
  totalPaidTransactions: number;

  /**
   * تعداد روزهایی که کاربر در 30 روز اخیر فعال بوده.
   */
  retentionDays: number;

  /**
   * نرخ‌های یادگیری‌شده.
   */
  purchaseRate: number;
  responseRate: number;
  matchRate: number;

  /**
   * فعلاً تعداد تراکنش‌ها و revenueScore را داریم.
   * مبلغ واقعی در RevenueIntelligenceService مدیریت می‌شود
   * چون Payment می‌تواند چند currency داشته باشد.
   */
  revenueScore: number;
}

@Injectable()
export class UserMetricsService {
  constructor(
    @InjectRepository(PartitionedEvent)
    private readonly activityRepo: Repository<PartitionedEvent>,

    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,

    private readonly entityManager: EntityManager,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // 7D METRICS
  // ───────────────────────────────────────────────────────────────────────────

  async get7dMetrics(userId: number) {
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

    const retentionDays = await this.getRetentionDays(userId);

    return {
      app_opens: Number(result[0]?.app_opens ?? 0),
      messages7d: Number(result[0]?.messages7d ?? 0),
      views7d: Number(result[0]?.views7d ?? 0),
      likes7d: Number(result[0]?.likes7d ?? 0),
      matches7d: Number(result[0]?.matches7d ?? 0),
      boostUsed7d: Number(result[0]?.boostUsed7d ?? 0),
      purchases7d: Number(result[0]?.purchases7d ?? 0),
      retentionDays,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RETENTION
  // ───────────────────────────────────────────────────────────────────────────

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

    return Number(result[0]?.retention_count ?? 0);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EVENT METRICS
  // ───────────────────────────────────────────────────────────────────────────

  async getBoostUsed7d(userId: number): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    return this.activityRepo.count({
      where: {
        userId,
        type: EventType.BOOST_USED,
        createdAt: MoreThan(sevenDaysAgo),
      },
    });
  }

  async getMessagesSent7d(userId: number): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    return this.activityRepo.count({
      where: {
        userId,
        type: EventType.MESSAGE_SENT,
        createdAt: MoreThan(sevenDaysAgo),
      },
    });
  }

  async getProfileViews7d(userId: number): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

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
      where: {
        userId,
        status: 'paid',
      },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EXTRA METRICS
  // ───────────────────────────────────────────────────────────────────────────

  async buildExtraMetrics(userId: number) {
    const [retentionDays, boostUsed7d, pastPayments, messages7d, views7d] =
      await Promise.all([
        this.getRetentionDays(userId),
        this.getBoostUsed7d(userId),
        this.getPastPayments(userId),
        this.getMessagesSent7d(userId),
        this.getProfileViews7d(userId),
      ]);

    return {
      retentionDays,
      boostUsed7d,
      pastPayments,
      messages7d,
      views7d,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ENGAGEMENT SLOPE
  // ───────────────────────────────────────────────────────────────────────────

  async getEngagementSlope(userId: number): Promise<number> {
    const now = new Date();

    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);

    const [recent, previous] = await Promise.all([
      this.activityRepo.count({
        where: {
          userId,
          createdAt: MoreThan(sevenDaysAgo),
        },
      }),

      this.activityRepo.count({
        where: {
          userId,
          createdAt: Between(fourteenDaysAgo, sevenDaysAgo),
        },
      }),
    ]);

    if (previous === 0) {
      return recent > 0 ? 1 : 0.5;
    }

    const ratio = recent / previous;

    return Math.min(Math.max(Math.round(ratio * 50) / 100, 0), 1);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CANONICAL INTELLIGENCE METRICS
  // ───────────────────────────────────────────────────────────────────────────

  async getUserIntelligenceMetrics(
    userId: number,
  ): Promise<UserIntelligenceMetrics> {
    const [
      totalEvents,
      activeDays,
      likes,
      matches,
      messagesSent,
      messagesReceived,
      replies,
      purchases,
      retentionDays,
    ] = await Promise.all([
      this.activityRepo.count({
        where: { userId },
      }),

      this.getActiveDays(userId),

      this.activityRepo.count({
        where: {
          userId,
          type: EventType.LIKE,
        },
      }),

      this.activityRepo.count({
        where: {
          userId,
          type: EventType.MATCH,
        },
      }),

      this.activityRepo.count({
        where: {
          userId,
          type: EventType.MESSAGE_SENT,
        },
      }),

      this.getMessagesReceived(userId),

      this.getReplies(userId),

      this.getPastPayments(userId),

      this.getRetentionDays(userId),
    ]);

    /**
     * نرخ خرید:
     *
     * purchases / max(activeDays, 1)
     *
     * عمداً smooth شده تا با چند رویداد
     * به سرعت به 1 نرسد.
     */
    const purchaseRate = Math.min(
      purchases / Math.max(activeDays * 0.25, 1),
      1,
    );

    /**
     * responseRate:
     * پاسخ‌ها نسبت به پیام‌های ارسالی.
     */
    const responseRate =
      messagesSent > 0 ? Math.min(replies / messagesSent, 1) : 0;

    /**
     * matchRate:
     * تعداد match نسبت به like.
     */
    const matchRate = likes > 0 ? Math.min(matches / likes, 1) : 0;

    /**
     * فعلاً revenueScore مستقل از مبلغ پولی است.
     * مقدار monetary revenue در RevenueIntelligenceService
     * محاسبه می‌شود.
     */
    const revenueScore = Math.min(purchases / 5, 1);

    return {
      totalEvents,
      activeDays,
      likes,
      matches,
      messagesSent,
      messagesReceived,
      replies,
      purchases,
      totalPaidTransactions: purchases,
      retentionDays,
      purchaseRate,
      responseRate,
      matchRate,
      revenueScore,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ACTIVE DAYS
  // ───────────────────────────────────────────────────────────────────────────

  private async getActiveDays(userId: number): Promise<number> {
    const result = await this.entityManager.query(
      `
      SELECT COUNT(DISTINCT DATE(createdAt)) AS active_days
      FROM user_events
      WHERE userId = ?
      `,
      [userId],
    );

    return Number(result[0]?.active_days ?? 0);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // MESSAGE RECEIVED
  // ───────────────────────────────────────────────────────────────────────────

  private async getMessagesReceived(userId: number): Promise<number> {
    const result = await this.entityManager.query(
      `
      SELECT COUNT(*) AS total
      FROM messages
      WHERE to_id = ?
      `,
      [userId],
    );

    return Number(result[0]?.total ?? 0);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RESPONSE LEARNING
  // ───────────────────────────────────────────────────────────────────────────

  private async getReplies(userId: number): Promise<number> {
    const result = await this.entityManager.query(
      `
      SELECT COUNT(*) AS replies
      FROM messages m1
      INNER JOIN messages m2
        ON m2.from_id = m1.to_id
       AND m2.to_id = m1.from_id
       AND m2.created_at > m1.created_at
       AND m2.created_at <= DATE_ADD(m1.created_at, INTERVAL 24 HOUR)
      WHERE m1.from_id = ?
      `,
      [userId],
    );

    return Number(result[0]?.replies ?? 0);
  }
}
