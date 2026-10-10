import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Payment, PaymentCurrency } from 'src/payments/entities/payment.entity';
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
  currency: PaymentCurrency;
  userCount: number;
  totalRevenue: number;
  ltv: number;
  cac: number | null;
  paybackPeriod: number | null;
}

export interface AnomalyResult {
  date: string;
  currency: PaymentCurrency;
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

interface SourceRevenue {
  revenueByCurrency: Partial<Record<PaymentCurrency, number>>;
  users: number;
  cac: number | null;
  ltv: Partial<Record<PaymentCurrency, number>>;
}

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
    const storedValue = await this.redis.get(`revenue:source:${source}`);

    if (!storedValue) {
      return DEFAULT_SOURCE_WEIGHTS[source] ?? 1;
    }

    const parsedWeight = Number.parseFloat(storedValue);

    if (!Number.isFinite(parsedWeight) || parsedWeight < 0) {
      return DEFAULT_SOURCE_WEIGHTS[source] ?? 1;
    }

    return parsedWeight;
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
      // fix #2: :date اضافه شد
      .where('user.createdAt >= :date', {
        date: new Date(Date.now() - days * 86400000),
      })
      .getMany();

    const sources: Record<string, SourceRevenue> = {};

    for (const user of users) {
      const source =
        user.acquisitionSource?.trim() ||
        user.metadata?.acquisitionSource?.trim() ||
        'organic';

      if (!sources[source]) {
        sources[source] = {
          revenueByCurrency: {},
          users: 0,
          cac: null,
          ltv: {},
        };
      }

      sources[source].users++;

      for (const payment of user.payments ?? []) {
        if (payment.status !== 'paid') {
          continue;
        }

        const currency = payment.currency as PaymentCurrency;

        if (['IRT', 'USDT', 'BTC', 'USD'].includes(currency)) {
          sources[source].revenueByCurrency[currency] =
            (sources[source].revenueByCurrency[currency] ?? 0) +
            Number(payment.amount);
        }
      }
    }

    const result: LTVResult[] = [];

    for (const [source, data] of Object.entries(sources)) {
      const weight = await this.getSourceWeight(source);

      void weight;

      for (const [currency, revenue] of Object.entries(
        data.revenueByCurrency,
      ) as [PaymentCurrency, number][]) {
        const totalRevenue = Number(revenue);

        if (!Number.isFinite(totalRevenue)) {
          continue;
        }

        result.push({
          source,
          currency,
          userCount: data.users,
          totalRevenue,
          ltv: data.users > 0 ? totalRevenue / data.users : 0,
          // ارز و واحد هزینهٔ SEOActivity مشخص نیست.
          // پس CAC و payback را جعل نمی‌کنیم.
          cac: null,
          paybackPeriod: null,
        });
      }
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
    if (!Number.isFinite(reward)) {
      throw new Error('reward must be a finite number');
    }

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
    thirtyDaysAgo.setHours(0, 0, 0, 0);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyRows = await this.paymentRepo
      .createQueryBuilder('p')
      .select('DATE(p.createdAt)', 'day')
      .addSelect('p.currency', 'currency')
      .addSelect('SUM(p.amount)', 'revenue')
      .addSelect('COUNT(*)', 'txCount')
      .where('p.status = :status', { status: 'paid' })
      .andWhere('p.createdAt >= :startDate', {
        startDate: thirtyDaysAgo,
      })
      .groupBy('DATE(p.createdAt)')
      .addGroupBy('p.currency')
      .orderBy('DATE(p.createdAt)', 'ASC')
      .getRawMany<{
        day: string;
        currency: PaymentCurrency;
        revenue: string;
        txCount: string;
      }>();

    const allCurrencies = [
      ...new Set(dailyRows.map((row) => row.currency)),
    ].filter((currency): currency is PaymentCurrency =>
      ['IRT', 'USDT', 'BTC', 'USD'].includes(currency),
    );

    const results: AnomalyResult[] = [];

    function formatLocalDate(date: Date): string {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');

      return `${year}-${month}-${day}`;
    }

    for (const currency of allCurrencies) {
      const revenueByDay = new Map<string, number>();

      for (const row of dailyRows) {
        if (row.currency !== currency) continue;

        revenueByDay.set(
          String(row.day).slice(0, 10),
          Number(row.revenue) || 0,
        );
      }

      const dailyRevenue: number[] = [];

      for (let offset = 29; offset >= 0; offset--) {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - offset);

        dailyRevenue.push(revenueByDay.get(formatLocalDate(date)) ?? 0);
      }

      const averageDailyRevenue =
        dailyRevenue.reduce((sum, value) => sum + value, 0) /
        dailyRevenue.length;

      for (let i = 0; i < 30; i++) {
        const date = new Date(thirtyDaysAgo);
        date.setDate(date.getDate() + i);
        const dateStr = formatLocalDate(date);

        const actualRevenue = revenueByDay.get(dateStr) ?? 0;
        const expectedRevenue = averageDailyRevenue;
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
          currency,
          actualRevenue,
          expectedRevenue,
          deviation,
          isAnomaly,
          reason,
        });
      }
    }

    const anomalyCount = results.filter((r) => r.isAnomaly).length;
    this.logger.log(
      `Revenue anomaly detection: ${anomalyCount} anomalies in last 30 days (1 query total)`,
    );

    return results;
  }

  /**
   * پیش‌بینی LTV کاربر جدید
   */
  async predictLTV(userId: number): Promise<number | null> {
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
        return null;
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
        return null;
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
        return null;
      }

      return (
        usersWithRevenue.reduce((sum, revenue) => sum + revenue, 0) /
        usersWithRevenue.length
      );
    }
  }
}
