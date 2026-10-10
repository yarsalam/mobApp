import { Injectable, Logger } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';

import { User } from '../users/entities/user.entity';
import { Payment, PaymentCurrency } from '../payments/entities/payment.entity';
import { SEOActivity } from '../seo/entities/seo-activity.entity';
import { PartitionedEvent } from '../user-event/entities/partitioned-event.entity';

export interface RevenueForecastPoint {
  date: string;
  revenue: number;
  confidence: [number, number];
}

export interface RevenueForecastResult {
  currency: PaymentCurrency;
  forecast: RevenueForecastPoint[];
  growthRate: number;
  peakDays: string[];
  alerts: {
    type: string;
    message: string;
  }[];
}

export interface LtvChannel {
  currency: PaymentCurrency;
  ltv: number;
  users: number;
  averageLtv: number;
}

export interface RevenueAnomaly {
  currency: PaymentCurrency;
  type: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  value?: number;
  baseline?: number;
  deviation?: number;
}

@Injectable()
export class RevenueIntelligenceService {
  private readonly logger = new Logger(RevenueIntelligenceService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,

    @InjectRepository(SEOActivity)
    private readonly seoActivityRepository: Repository<SEOActivity>,

    @InjectRepository(PartitionedEvent)
    private readonly eventRepository: Repository<PartitionedEvent>,

    private readonly dataSource: DataSource,
  ) {}

  // ============================================================
  // LTV BY CHANNEL
  // ============================================================

  async getLTVByChannel(
    currency: PaymentCurrency = 'IRT',
  ): Promise<Record<string, LtvChannel>> {
    const validCurrencies: PaymentCurrency[] = ['IRT', 'USDT', 'BTC', 'USD'];

    if (!validCurrencies.includes(currency)) {
      throw new Error(`Unsupported currency: ${currency}`);
    }

    const users = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect(
        'user.payments',
        'payment',
        'payment.status = :status AND payment.currency = :currency',
        { status: 'paid', currency },
      )
      .getMany();

    const channels = new Map<string, { revenue: number; users: number }>();

    for (const user of users) {
      const source = (
        user.acquisitionSource?.trim() ||
        user.metadata?.acquisitionSource?.trim() ||
        'organic'
      ).toLowerCase();

      if (!channels.has(source)) {
        channels.set(source, { revenue: 0, users: 0 });
      }

      const channel = channels.get(source)!;
      channel.users += 1;

      for (const payment of user.payments ?? []) {
        const amount = Number(payment.amount);

        if (Number.isFinite(amount) && amount > 0) {
          channel.revenue += amount;
        }
      }
    }

    const result: Record<string, LtvChannel> = {};

    for (const [source, data] of channels) {
      result[source] = {
        currency,
        users: data.users,
        ltv: this.round(data.revenue),
        averageLtv: data.users > 0 ? this.round(data.revenue / data.users) : 0,
      };
    }

    return result;
  }

  // ============================================================
  // FORECAST
  // ============================================================

  async forecastRevenue(
    days = 90,
    currency: PaymentCurrency = 'IRT',
  ): Promise<RevenueForecastResult> {
    const safeDays = Math.max(1, Math.min(days, 365));

    try {
      const historical = await this.getDailyRevenueHistory(30, currency);

      /**
       * اگر داده تاریخی نداریم،
       * forecast نباید NaN یا undefined تولید کند.
       */
      if (!historical.length) {
        return {
          currency,
          forecast: [],
          growthRate: 0,
          peakDays: [],
          alerts: [
            {
              type: 'insufficient_data',
              message: 'Not enough revenue history for forecasting',
            },
          ],
        };
      }

      const values = historical.map((item) => item.revenue);

      const average = this.mean(values);

      const recent = values.slice(Math.max(0, values.length - 7));

      const recentAverage = this.mean(recent);

      const older = values.slice(0, Math.max(1, values.length - 7));

      const olderAverage = this.mean(older);

      /**
       * رشد اخیر نسبت به baseline
       */
      const growthRate =
        olderAverage > 0 ? (recentAverage - olderAverage) / olderAverage : 0;

      /**
       * Trend را محدود می‌کنیم تا یک outlier
       * کل forecast را منفجر نکند.
       */
      const boundedGrowth = Math.max(-0.5, Math.min(0.5, growthRate));

      const forecast: RevenueForecastPoint[] = [];

      for (let i = 1; i <= safeDays; i++) {
        const date = new Date();

        date.setDate(date.getDate() + i);

        /**
         * رشد مرکب ملایم
         */
        const trendFactor = Math.pow(1 + boundedGrowth * 0.1, i / 30);

        const predicted = Math.max(0, recentAverage * trendFactor);

        /**
         * confidence interval
         */
        const uncertainty = Math.max(average * 0.25, predicted * 0.15);

        forecast.push({
          date: date.toISOString().slice(0, 10),

          revenue: this.round(predicted),

          confidence: [
            this.round(Math.max(0, predicted - uncertainty)),

            this.round(predicted + uncertainty),
          ],
        });
      }

      const peakDays = this.detectPeakDays(historical);

      const alerts: RevenueForecastResult['alerts'] = [];

      if (growthRate < -0.2) {
        alerts.push({
          type: 'negative_growth',
          message: 'Revenue trend is declining significantly',
        });
      }

      if (growthRate > 0.3) {
        alerts.push({
          type: 'rapid_growth',
          message: 'Revenue is growing unusually fast',
        });
      }

      return {
        currency,
        forecast,
        growthRate: this.round(growthRate),
        peakDays,
        alerts,
      };
    } catch (error) {
      this.logger.error(
        'Revenue forecast failed',
        error instanceof Error ? error.stack : String(error),
      );

      return {
        currency,
        forecast: [],
        growthRate: 0,
        peakDays: [],
        alerts: [
          {
            type: 'forecast_error',
            message: 'Revenue forecast failed',
          },
        ],
      };
    }
  }

  // ============================================================
  // ANOMALY DETECTION
  // ============================================================

  async detectAnomalies(
    currency: PaymentCurrency = 'IRT',
  ): Promise<RevenueAnomaly[]> {
    try {
      const history = await this.getDailyRevenueHistory(30, currency);

      if (history.length < 7) {
        return [];
      }

      const values = history.map((item) => item.revenue);

      const mean = this.mean(values);

      const std = this.standardDeviation(values);

      if (std <= 0 || !Number.isFinite(std)) {
        return [];
      }

      const latest = values[values.length - 1];

      const zScore = (latest - mean) / std;

      const anomalies: RevenueAnomaly[] = [];

      if (Math.abs(zScore) >= 3) {
        anomalies.push({
          currency,
          type: latest > mean ? 'revenue_spike' : 'revenue_drop',

          message:
            latest > mean
              ? 'Revenue is significantly above the normal baseline'
              : 'Revenue is significantly below the normal baseline',

          severity: 'high',

          value: this.round(latest),

          baseline: this.round(mean),

          deviation: this.round(zScore),
        });
      } else if (Math.abs(zScore) >= 2) {
        anomalies.push({
          currency,
          type: latest > mean ? 'revenue_increase' : 'revenue_decrease',

          message:
            latest > mean
              ? 'Revenue is above the normal baseline'
              : 'Revenue is below the normal baseline',

          severity: 'medium',

          value: this.round(latest),

          baseline: this.round(mean),

          deviation: this.round(zScore),
        });
      }

      return anomalies;
    } catch (error) {
      this.logger.error(
        'Revenue anomaly detection failed',
        error instanceof Error ? error.stack : String(error),
      );

      return [];
    }
  }

  // ============================================================
  // LTV WITH ATTRIBUTION
  // ============================================================

  async calculateLTVWithAttribution(
    userId: number,
    currency: PaymentCurrency = 'IRT',
  ): Promise<number> {
    if (!userId) {
      return 0;
    }

    try {
      const payments = await this.paymentRepository.find({
        where: {
          userId,
          status: 'paid',
          currency,
        } as any,
      });

      return this.round(
        payments.reduce((sum, payment) => {
          const amount = Number((payment as any).amount ?? 0);

          return Number.isFinite(amount) ? sum + amount : sum;
        }, 0),
      );
    } catch (error) {
      this.logger.warn(`Failed to calculate LTV for user ${userId}`);

      return 0;
    }
  }

  // ============================================================
  // LTV BY SOURCE
  // ============================================================

  async calculateLTVBySource(source: string): Promise<number> {
    if (!source) {
      return 0;
    }

    const channels = await this.getLTVByChannel();

    return channels[source]?.ltv ?? 0;
  }

  // ============================================================
  // SAVE REVENUE METRICS
  // ============================================================

  async saveRevenueMetrics(metrics: Record<string, unknown>): Promise<void> {
    /**
     * Compatibility layer.
     *
     * فعلاً داده‌های Revenue از Payment/Event
     * محاسبه می‌شوند و storage جداگانه‌ای برای
     * metrics ایجاد نمی‌کنیم.
     *
     * در مرحله بعد اگر RevenueSnapshot entity
     * داشته باشیم، اینجا persistence واقعی قرار می‌گیرد.
     */

    if (!metrics) {
      return;
    }

    this.logger.debug('Revenue metrics received');
  }

  // ============================================================
  // DAILY REVENUE HISTORY
  // ============================================================

  private async getDailyRevenueHistory(
    days: number,
    currency: PaymentCurrency = 'IRT',
  ): Promise<Array<{ date: string; revenue: number }>> {
    const safeDays = Math.max(1, Math.min(days, 365));

    const end = new Date();
    end.setHours(0, 0, 0, 0);

    const start = new Date(end);
    start.setDate(start.getDate() - safeDays + 1);

    const rows = await this.paymentRepository
      .createQueryBuilder('payment')
      .select('DATE(payment.createdAt)', 'date')
      .addSelect('SUM(payment.amount)', 'revenue')
      .where('payment.status = :status', { status: 'paid' })
      .andWhere('payment.currency = :currency', { currency })
      .andWhere('payment.createdAt >= :start', { start })
      .andWhere('payment.createdAt < :end', {
        end: new Date(end.getTime() + 24 * 60 * 60 * 1000),
      })
      .groupBy('DATE(payment.createdAt)')
      .orderBy('DATE(payment.createdAt)', 'ASC')
      .getRawMany<{ date: string; revenue: string }>();

    const byDate = new Map(
      rows.map((row) => [
        String(row.date).slice(0, 10),
        Number(row.revenue) || 0,
      ]),
    );

    const result: Array<{ date: string; revenue: number }> = [];

    for (let offset = 0; offset < safeDays; offset++) {
      const date = new Date(start);
      date.setDate(start.getDate() + offset);

      const key = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');

      result.push({
        date: key,
        revenue: this.round(byDate.get(key) ?? 0),
      });
    }

    return result;
  }

  // ============================================================
  // PAYMENT SOURCE
  // ============================================================

  private extractPaymentSource(payment: Payment): string {
    const raw = payment as any;

    const source =
      raw.source ??
      raw.acquisitionSource ??
      raw.channel ??
      raw.metadata?.source ??
      raw.metadata?.acquisitionSource ??
      raw.metadata?.channel ??
      raw.gateway ??
      'unknown';

    return String(source || 'unknown').toLowerCase();
  }

  // ============================================================
  // PEAK DAYS
  // ============================================================

  private detectPeakDays(
    history: Array<{
      date: string;
      revenue: number;
    }>,
  ): string[] {
    if (!history.length) {
      return [];
    }

    const sorted = [...history].sort((a, b) => b.revenue - a.revenue);

    return sorted.slice(0, Math.min(5, sorted.length)).map((item) => item.date);
  }

  // ============================================================
  // MATH HELPERS
  // ============================================================

  private mean(values: number[]): number {
    if (!values.length) {
      return 0;
    }

    return (
      values.reduce(
        (sum, value) => sum + (Number.isFinite(value) ? value : 0),
        0,
      ) / values.length
    );
  }

  private standardDeviation(values: number[]): number {
    if (values.length < 2) {
      return 0;
    }

    const average = this.mean(values);

    const variance = this.mean(
      values.map((value) => Math.pow(value - average, 2)),
    );

    return Math.sqrt(variance);
  }

  private round(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.round(value * 100) / 100;
  }
}
