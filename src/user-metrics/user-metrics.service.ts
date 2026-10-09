import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Payment } from 'src/payments/entities/payment.entity';
import { Between, EntityManager, MoreThan, Repository } from 'typeorm';

import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { EventType } from 'src/user-event/type/event-type.enum';
import { Message } from 'src/message/entities/message.entity';

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
  paymentAttempts: number;
}

@Injectable()
export class UserMetricsService {
  constructor(
    @InjectRepository(PartitionedEvent)
    private readonly activityRepo: Repository<PartitionedEvent>,

    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,

    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,

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
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new Error('Invalid userId for intelligence metrics');
    }

    const [
      totalEvents,
      activeDays,
      likes,
      matches,
      messagesSent,
      messagesReceived,
      replies,
      purchases,
      paymentAttempts,
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

      this.messageRepo.count({
        where: { from_id: userId },
      }),

      this.getMessagesReceived(userId),

      this.getReplies(userId),

      this.getPastPayments(userId),

      this.paymentRepo.count({
        where: { userId },
      }),

      this.getRetentionDays(userId),
    ]);

    // تعداد پرداخت‌های موفق تقسیم بر تعداد تلاش‌های ثبت‌شده.
    // اگر هیچ تلاشی وجود ندارد، نرخ صفر است.
    const purchaseRate =
      paymentAttempts > 0 ? Math.min(purchases / paymentAttempts, 1) : 0;

    // تعداد پیام‌های ارسالی که ظرف ۲۴ ساعت پاسخ گرفته‌اند،
    // تقسیم بر کل پیام‌های ارسالی.
    const responseRate =
      messagesSent > 0 ? Math.min(replies / messagesSent, 1) : 0;

    // نرخ Match نسبت به Like؛ این تعریف فعلاً all-time است.
    const matchRate = likes > 0 ? Math.min(matches / likes, 1) : 0;

    // این امتیاز تخمینی است و معادل LTV پولی نیست.
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
      paymentAttempts,
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
    SELECT COUNT(DISTINCT m1.id) AS replies
    FROM messages m1
    WHERE m1.from_id = ?
      AND EXISTS (
        SELECT 1
        FROM messages m2
        WHERE m2.from_id = m1.to_id
          AND m2.to_id = m1.from_id
          AND m2.created_at > m1.created_at
          AND m2.created_at <= DATE_ADD(
            m1.created_at,
            INTERVAL 24 HOUR
          )
      )
    `,
      [userId],
    );

    return Math.max(0, Number(result[0]?.replies ?? 0));
  }
}
