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
import { SEOActivity } from 'src/seo/entities/seo-activity.entity';

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
      const source = user.metadata?.acquisitionSource || 'organic';
      const weight = await this.getSourceWeight(source);

      if (!sources[source]) {
        sources[source] = { users: 0, revenue: 0, totalWeight: 0 };
      }

      sources[source].users++;
      const userRevenue =
        user.payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;
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
    const activities = await this.seoActivityRepo.find({
      where: {
        performedAt: Between(
          new Date(Date.now() - days * 24 * 60 * 60 * 1000),
          new Date(),
        ),
        platform: source as any,
      },
    });

    const totalCost = activities.reduce((sum, a) => sum + Number(a.cost), 0);

    const userCount = await this.userRepo.count({
      where: {
        metadata: {
          acquisitionSource: source,
        },
      },
    });

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

    const dailyRefundRows = await this.paymentRepo
      .createQueryBuilder('p')
      .select('DATE(p.createdAt)', 'date')
      .addSelect('COUNT(*)', 'refundCount')
      .where('p.createdAt >= :start', { start: thirtyDaysAgo })
      .andWhere("p.status IN ('refunded', 'cancelled')")
      .groupBy('DATE(p.createdAt)')
      .getRawMany<{ date: string; refundCount: string }>();

    const revenueMap = new Map(
      dailyRevenueRows.map((r) => [r.date, parseFloat(r.total)]),
    );
    const txCountMap = new Map(
      dailyRevenueRows.map((r) => [r.date, parseInt(r.txCount)]),
    );
    const refundMap = new Map(
      dailyRefundRows.map((r) => [r.date, parseInt(r.refundCount)]),
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
        const refundCount = refundMap.get(dateStr) ?? 0;
        const txCount = txCountMap.get(dateStr) ?? 0;

        if (actualRevenue === 0 && txCount === 0) {
          reason = 'no_transactions';
        } else if (refundCount > txCount * 0.3) {
          reason = 'high_refund_rate';
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
      const aiRevenueUrl = this.configService.get(
        'AI_REVENUE_URL',
        'http://ai_revenue:8006',
      );
      const features = await this.featureStore.getUserFeatures(userId);
      const response = await firstValueFrom(
        // fix #6: backtick اضافه شد
        this.httpService.post(`${aiRevenueUrl}/predict/ltv`, {
          userId,
          features,
        }),
      );
      return response.data.predicted_ltv;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error('ML prediction failed, using fallback: ' + message);

      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) return 0;

      const similarUsers = await this.userRepo
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.payments', 'payments')
        // fix #3: :city اضافه شد
        .where('user.city = :city', { city: user.city })
        // fix #4: :gender اضافه شد
        .andWhere('user.gender = :gender', { gender: user.gender })
        .getMany();

      if (similarUsers.length === 0) return 150;

      const totalLTV = similarUsers.reduce((sum, u) => {
        const userRevenue =
          u.payments?.reduce((s, p) => s + Number(p.amount), 0) || 0;
        return sum + userRevenue;
      }, 0);

      return totalLTV / similarUsers.length;
    }
  }
}
