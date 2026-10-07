import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, Between, LessThan } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Payment } from '../payments/entities/payment.entity';
import { SEOActivity } from '../seo/entities/seo-activity.entity';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class RevenueIntelligenceService {
  private readonly logger = new Logger(RevenueIntelligenceService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,

    @InjectRepository(SEOActivity)
    private readonly seoActivityRepo: Repository<SEOActivity>,

    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,

    private readonly entityManager: EntityManager,

    @InjectQueue('revenue-intelligence')
    private readonly queue: Queue,
  ) {}

  /**
   * محاسبه LTV با تخصیص چندلمسی
   */
  async calculateLTVWithAttribution(
    userId: number,
    attributionModel:
      | 'last-touch'
      | 'first-touch'
      | 'linear'
      | 'time-decay' = 'time-decay',
  ): Promise<{
    ltv: number;
    cac: number;
    paybackPeriod: number;
    attribution: Array<{ channel: string; weight: number; revenue: number }>;
  }> {
    // 1. دریافت تمام رویدادهای کاربر قبل از اولین خرید
    const firstPurchase = await this.paymentRepo.findOne({
      where: { userId, status: 'paid' },
      order: { createdAt: 'ASC' },
    });

    if (!firstPurchase) {
      return {
        ltv: 0,
        cac: 0,
        paybackPeriod: 0,
        attribution: [],
      };
    }

    // 2. دریافت تمام تعاملات قبل از خرید
    const events = await this.eventRepo.find({
      where: {
        userId,
        createdAt: LessThan(firstPurchase.createdAt),
      },
      order: { createdAt: 'ASC' },
    });

    // 3. دریافت فعالیت‌های سئو در بازه زمانی
    const seoActivities = await this.seoActivityRepo.find({
      where: {
        performedAt: Between(
          new Date(
            firstPurchase.createdAt.getTime() - 30 * 24 * 60 * 60 * 1000,
          ),
          firstPurchase.createdAt,
        ),
      },
    });

    // 4. محاسبه LTV کل
    const allPayments = await this.paymentRepo.find({
      where: { userId, status: 'paid' },
    });
    const totalLTV = allPayments.reduce((sum, p) => sum + p.amount, 0);

    // 5. تخصیص چندلمسی
    const attribution = this.calculateAttribution(
      events,
      seoActivities,
      totalLTV,
      attributionModel,
    );

    // 6. محاسبه CAC (از فعالیت‌های سئو)
    const cac = await this.calculateCAC(userId, firstPurchase.createdAt);

    return {
      ltv: totalLTV,
      cac,
      paybackPeriod: cac > 0 ? totalLTV / cac : 0,
      attribution,
    };
  }

  private calculateAttribution(
    events: PartitionedEvent[],
    seoActivities: SEOActivity[],
    totalRevenue: number,
    model: string,
  ): Array<{ channel: string; weight: number; revenue: number }> {
    const channels = new Map<string, number>();

    // وزن‌دهی به کانال‌ها
    for (const event of events) {
      const channel = this.mapEventToChannel(event);
      let weight = 0;

      switch (model) {
        case 'first-touch':
          weight = events.indexOf(event) === 0 ? 1 : 0;
          break;
        case 'last-touch':
          weight = events.indexOf(event) === events.length - 1 ? 1 : 0;
          break;
        case 'linear':
          weight = 1 / events.length;
          break;
        case 'time-decay':
          const position = events.indexOf(event);
          weight = Math.exp(-0.1 * (events.length - position));
          break;
      }

      channels.set(channel, (channels.get(channel) || 0) + weight);
    }

    // اضافه کردن فعالیت‌های سئو
    for (const activity of seoActivities) {
      const channel = activity.platform;
      const weight = activity.cost / 1000; // normalize
      channels.set(channel, (channels.get(channel) || 0) + weight);
    }

    // نرمالایز کردن وزن‌ها
    const totalWeight = Array.from(channels.values()).reduce(
      (a, b) => a + b,
      0,
    );

    return Array.from(channels.entries()).map(([channel, weight]) => ({
      channel,
      weight: weight / totalWeight,
      revenue: (weight / totalWeight) * totalRevenue,
    }));
  }

  private mapEventToChannel(event: PartitionedEvent): string {
    switch (event.type) {
      case EventType.USER_REGISTERED:
        return event.metadata?.source || 'organic';
      case EventType.PROMOTION_CLICKED:
        return event.metadata?.variant || 'promotion';
      default:
        return 'other';
    }
  }

  private async calculateCAC(
    userId: number,
    purchaseDate: Date,
  ): Promise<number> {
    // هزینه‌های جذب در بازه ۳۰ روز قبل از خرید
    const activities = await this.seoActivityRepo.find({
      where: {
        performedAt: Between(
          new Date(purchaseDate.getTime() - 30 * 24 * 60 * 60 * 1000),
          purchaseDate,
        ),
      },
    });

    const totalCost = activities.reduce((sum, a) => sum + a.cost, 0);

    // تعداد کاربرانی که در این بازه ثبت‌نام کردن
    const newUsers = await this.userRepo.count({
      where: {
        createdAt: Between(
          new Date(purchaseDate.getTime() - 30 * 24 * 60 * 60 * 1000),
          purchaseDate,
        ),
      },
    });

    return newUsers > 0 ? totalCost / newUsers : 0;
  }

  /**
   * پیش‌بینی درآمد ۳ ماه آینده
   */
  async forecastRevenue(days = 90): Promise<{
    forecast: Array<{
      date: string;
      revenue: number;
      confidence: [number, number];
    }>;
    growthRate: number;
    peakDays: string[];
    alerts: Array<{ type: string; message: string }>;
  }> {
    // ارسال به ML service
    const job = await this.queue.add('forecast-revenue', {
      days,
      timestamp: new Date(),
    });

    // دریافت نتیجه (async)
    const result = await job.waitUntilFinished(
      this.queue as any,
      30000, // 30 ثانیه timeout
    );

    return result;
  }

  /**
   * تشخیص ناهنجاری‌های درآمدی
   */
  async detectAnomalies(): Promise<
    Array<{
      date: Date;
      expected: number;
      actual: number;
      deviation: number;
      severity: 'low' | 'medium' | 'high';
      reason: string;
    }>
  > {
    // ✅ N+1 fix: یک query برای همه 30 روز به جای 90 query جداگانه
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyRevenue: Array<{ date: string; total: string }> =
      await this.entityManager.query(
        `SELECT DATE(created_at) as date, SUM(amount) as total
         FROM payment
         WHERE created_at >= ? AND status = 'paid'
         GROUP BY DATE(created_at)
         ORDER BY date DESC`,
        [thirtyDaysAgo],
      );

    const revenueMap = new Map(
      dailyRevenue.map((r) => [r.date, parseFloat(r.total)]),
    );

    // میانگین 30 روز به عنوان baseline
    const values = [...revenueMap.values()];
    const avgRevenue = values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;

    const anomalies: Array<{
      date: Date;
      expected: number;
      actual: number;
      severity: 'low' | 'medium' | 'high';
      deviation: number;
      reason: string;
    }> = [];

    for (let i = 1; i <= 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const actualRevenue = revenueMap.get(dateStr) ?? 0;
      const expectedRevenue = avgRevenue || 1;
      const deviation =
        Math.abs(actualRevenue - expectedRevenue) / expectedRevenue;

      if (deviation > 0.3) {
        anomalies.push({
          date,
          expected: expectedRevenue,
          actual: actualRevenue,
          deviation,
          severity: deviation > 0.5 ? 'high' : 'medium',
          reason: deviation > 0.5 ? 'افت شدید درآمد' : 'انحراف از میانگین',
        });
      }
    }

    return anomalies;
  }

  private async getRevenueForDate(date: Date): Promise<number> {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const payments = await this.paymentRepo.find({
      where: {
        createdAt: Between(start, end),
        status: 'paid',
      },
    });

    return payments.reduce((sum, p) => sum + p.amount, 0);
  }

  private async getExpectedRevenue(date: Date): Promise<number> {
    // میانگین ۳۰ روز مشابه قبل
    const dayOfWeek = date.getDay();
    const similarDays: number[] = [];

    for (let i = 1; i <= 4; i++) {
      const similarDate = new Date(date);
      similarDate.setDate(date.getDate() - i * 7); // هفته قبل
      similarDays.push(await this.getRevenueForDate(similarDate));
    }

    return similarDays.reduce((a, b) => a + b, 0) / similarDays.length;
  }

  private async findAnomalyReason(
    date: Date,
    deviation: number,
  ): Promise<string> {
    // بررسی فعالیت‌های سئو
    const activities = await this.seoActivityRepo.find({
      where: {
        performedAt: Between(
          new Date(date.getTime() - 7 * 24 * 60 * 60 * 1000),
          date,
        ),
      },
    });

    if (activities.length === 0) {
      return 'No SEO activities in the past week';
    }

    const totalSpent = activities.reduce((sum, a) => sum + a.cost, 0);
    if (totalSpent < 100 && deviation > 0.5) {
      return 'Low marketing spend';
    }

    return 'Unknown anomaly';
  }

  async getLTVByChannel(): Promise<any> {}

  async calculateLTVBySource(): Promise<
    Record<string, { ltv: number; count: number }>
  > {
    const result: any = {};
    return result;
  }

  async saveRevenueMetrics(data: {
    source: string;
    revenue: number;
    cost: number;
    timestamp: Date;
    metrics?: any;
    ltvBySource?: any;
  }) {}
}
