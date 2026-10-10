import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Payment } from 'src/payments/entities/payment.entity';
import { User } from 'src/users/entities/user.entity';
import { Repository, Between } from 'typeorm';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/redis/redis.constants';
import { HttpService } from '@nestjs/axios';
import { FeatureStoreService } from 'src/feature-store/feature-store.service';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  ActivityPlatform,
  SEOActivity,
} from 'src/seo/entities/seo-activity.entity';

export interface LTVResult {
  source: string;
  userCount: number;
  totalRevenue: number;
  ltv: number;
  cac: number;
  paybackPeriod: number;
}

export interface AnomalyResult {
  date: string;
  actualRevenue: number;
  expectedRevenue: number;
  deviation: number;
  isAnomaly: boolean;
  reason?: string;
}

const DEFAULT_SOURCE_WEIGHTS = {
  organic: 1.0,
  instagram: 1.2,
  telegram: 1.1,
  google: 1.3,
  direct: 0.9,
  referral: 1.0,
};

const ANOMALY_THRESHOLD = 0.2;

@Injectable()
export class RevenueAttributionService {
  private readonly logger = new Logger(RevenueAttributionService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,

    @InjectRepository(SEOActivity)
    private readonly seoActivityRepo: Repository<SEOActivity>,

    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,

    @Inject(REDIS_CLIENT) private readonly redis: Redis,

    private readonly httpService: HttpService,
    private readonly featureStore: FeatureStoreService,
    private readonly configService: ConfigService,
  ) {}

  // fix #5: backtick اضافه شد
  private async getSourceWeight(source: string): Promise<number> {
    const stored = await this.redis.get(`revenue:source:${source}`);
    return stored ? parseFloat(stored) : DEFAULT_SOURCE_WEIGHTS[source] || 1.0;
  }

  // fix #5: backtick اضافه شد
  private async setSourceWeight(source: string, weight: number): Promise<void> {
    await this.redis.set(`revenue:source:${source}`, weight.toString());
  }

  /**
   * محاسبه LTV هر کاربر بر اساس منبع جذب
   */
  async calculateLTVBySource(days = 90): Promise<LTVResult[]> {
    const users = await this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.payments', 'payments')
      .leftJoinAndSelect('user.userEvents', 'events')
      // fix #2: :date اضافه شد
      .where('user.createdAt >= :date', {
        date: new Date(Date.now() - days * 86400000),
      })
      .getMany();

    const sources: Record<
      string,
      { users: number; revenue: number; totalWeight: number }
    > = {};

    for (const user of users) {
      const source =
        user.acquisitionSource?.trim() ||
        user.metadata?.acquisitionSource?.trim() ||
        'organic';
      const weight = await this.getSourceWeight(source);

      if (!sources[source]) {
        sources[source] = { users: 0, revenue: 0, totalWeight: 0 };
      }

      sources[source].users++;
      const userRevenue =
        user.payments?.reduce((sum, payment) => {
          if (payment.status !== 'paid') {
            return sum;
          }

          return sum + Number(payment.amount);
        }, 0) ?? 0;

      sources[source].revenue += userRevenue;
      sources[source].totalWeight += weight;
    }

    const result: LTVResult[] = [];
    for (const [source, data] of Object.entries(sources)) {
      const cac = await this.getCACForSource(source, days);
      const avgWeight = data.users > 0 ? data.totalWeight / data.users : 1;
      const rawLTV = data.revenue / data.users;
      const adjustedLTV = rawLTV * avgWeight;

      result.push({
        source,
        userCount: data.users,
        totalRevenue: data.revenue,
        ltv: adjustedLTV,
        cac,
        paybackPeriod: cac > 0 ? adjustedLTV / cac : 0,
      });
    }

    return result;
  }

  private async getCACForSource(source: string, days: number): Promise<number> {
    const platformBySource: Partial<Record<string, ActivityPlatform>> = {
      instagram: ActivityPlatform.INSTAGRAM,
      telegram: ActivityPlatform.TELEGRAM,
      google: ActivityPlatform.GOOGLE_ADS,
      google_ads: ActivityPlatform.GOOGLE_ADS,
      linkedin: ActivityPlatform.LINKEDIN,
      medium: ActivityPlatform.MEDIUM,
      quora: ActivityPlatform.QUORA,
    };

    const platform = platformBySource[source];

    // برای منابعی که نگاشت مشخص ندارند، CAC ساختگی تولید نکن.
    if (!platform) {
      return 0;
    }

    const now = new Date();
    const since = new Date(now.getTime() - days * 86_400_000);

    const [activities, userCount] = await Promise.all([
      this.seoActivityRepo.find({
        where: {
          performedAt: Between(since, now),
          platform,
        },
      }),

      this.userRepo
        .createQueryBuilder('user')
        .where('user.createdAt >= :since', { since })
        .andWhere('user.createdAt <= :now', { now })
        .andWhere(
          `(
          user.acquisitionSource = :source
          OR JSON_UNQUOTE(
            JSON_EXTRACT(user.metadata, '$.acquisitionSource')
          ) = :source
        )`,
          { source },
        )
        .getCount(),
    ]);

    const totalCost = activities.reduce(
      (sum, activity) => sum + Number(activity.cost || 0),
      0,
    );

    return userCount > 0 ? totalCost / userCount : 0;
  }

  async adjustSourceWeight(source: string, reward: number): Promise<void> {
    const current = await this.getSourceWeight(source);
    const learningRate = 0.01;
    const newWeight = Math.max(0.1, current + learningRate * reward);
    await this.setSourceWeight(source, newWeight);

    this.logger.log(
      `Source weight "${source}" adjusted: ${current.toFixed(2)} → ${newWeight.toFixed(2)} (reward: ${reward})`,
    );
  }

  /**
   * آنالیز anomaly درآمد ۳۰ روز گذشته
   */
  async detectRevenueAnomalies(): Promise<AnomalyResult[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyRevenueRows = await this.paymentRepo
      .createQueryBuilder('p')
      .select('DATE(p.createdAt)', 'date')
      .addSelect('SUM(p.amount)', 'total')
      .addSelect('COUNT(*)', 'txCount')
      .where('p.createdAt >= :start', { start: thirtyDaysAgo })
      // fix #12: status یکسان‌سازی شد — 'paid' در همه جا
      .andWhere("p.status = 'paid'")
      .groupBy('DATE(p.createdAt)')
      .orderBy('DATE(p.createdAt)', 'ASC')
      .getRawMany<{ date: string; total: string; txCount: string }>();

    const dailyRefundRows: Array<{
      date: string;
      refundCount: string;
    }> = [];

    const revenueMap = new Map(
      dailyRevenueRows.map((r) => [r.date, parseFloat(r.total)]),
    );

    const allRevenues = [...revenueMap.values()];
    const avgRevenue =
      allRevenues.length > 0
        ? allRevenues.reduce((sum, v) => sum + v, 0) / allRevenues.length
        : 0;

    const results: AnomalyResult[] = [];

    for (let i = 0; i < 30; i++) {
      const date = new Date(thirtyDaysAgo);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];

      const actualRevenue = revenueMap.get(dateStr) ?? 0;
      const expectedRevenue = avgRevenue;
      const deviation =
        expectedRevenue > 0
          ? (actualRevenue - expectedRevenue) / expectedRevenue
          : 0;
      const isAnomaly = Math.abs(deviation) > ANOMALY_THRESHOLD;

      let reason: string | undefined;
      if (isAnomaly) {
        if (actualRevenue === 0) {
          reason = 'no_transactions';
        } else if (deviation < -ANOMALY_THRESHOLD) {
          reason = 'revenue_drop';
        } else {
          reason = 'revenue_spike';
        }
      }

      results.push({
        date: dateStr,
        actualRevenue,
        expectedRevenue,
        deviation,
        isAnomaly,
        reason,
      });
    }

    const anomalyCount = results.filter((r) => r.isAnomaly).length;
    this.logger.log(
      `Revenue anomaly detection: ${anomalyCount} anomalies in last 30 days (2 queries total)`,
    );

    return results;
  }

  /**
   * پیش‌بینی LTV کاربر جدید
   */
  async predictLTV(userId: number): Promise<number> {
    try {
      const aiRevenueUrl = this.configService
        .get<string>('AI_REVENUE_URL', 'http://ai_revenue:8006')
        .replace(/\/+$/, '');

      const configuredTimeout = Number(
        this.configService.get<string | number>('AI_REVENUE_TIMEOUT_MS', 5000),
      );

      const timeout =
        Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0
          ? configuredTimeout
          : 5000;

      const features = await this.featureStore.getUserFeatures(userId);

      const response = await firstValueFrom(
        this.httpService.post(
          `${aiRevenueUrl}/predict/ltv`,
          { userId, features },
          { timeout },
        ),
      );

      const predictedLtv: unknown = response.data?.predicted_ltv;

      if (
        typeof predictedLtv !== 'number' ||
        !Number.isFinite(predictedLtv) ||
        predictedLtv < 0
      ) {
        throw new Error('AI service returned an invalid predicted_ltv');
      }

      return predictedLtv;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`ML prediction failed, using fallback: ${message}`);

      const user = await this.userRepo.findOne({
        where: { id: userId },
      });

      if (!user) {
        return 0;
      }

      const similarUsers = await this.userRepo
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.payments', 'payments')
        .where('user.id != :userId', { userId })
        .andWhere('user.city = :city', { city: user.city })
        .andWhere('user.gender = :gender', { gender: user.gender })
        .getMany();

      const paidCurrencies = new Set(
        similarUsers.flatMap((similarUser) =>
          (similarUser.payments ?? [])
            .filter((payment) => payment.status === 'paid')
            .map((payment) => payment.currency),
        ),
      );

      // بدون نرخ تبدیل، جمع ارزهای مختلف قابل اتکا نیست.
      if (paidCurrencies.size !== 1) {
        return 0;
      }

      const currency = [...paidCurrencies][0];

      const usersWithRevenue = similarUsers
        .map((similarUser) => {
          const revenue = (similarUser.payments ?? [])
            .filter(
              (payment) =>
                payment.status === 'paid' && payment.currency === currency,
            )
            .reduce((sum, payment) => sum + Number(payment.amount), 0);

          return revenue;
        })
        .filter((revenue) => Number.isFinite(revenue));

      if (usersWithRevenue.length === 0) {
        return 0;
      }

      return (
        usersWithRevenue.reduce((sum, revenue) => sum + revenue, 0) /
        usersWithRevenue.length
      );
    }
  }
}
