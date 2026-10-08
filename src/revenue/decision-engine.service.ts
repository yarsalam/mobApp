import { Injectable, Logger } from '@nestjs/common';
import { RevenueIntelligenceService } from './revenue-intelligence.service';

interface LtvChannel {
  ltv: number;
  users: number;
  averageLtv: number;
}

interface RevenueForecastPoint {
  date: string;
  revenue: number;
  confidence: [number, number];
}

interface RevenueForecastResult {
  forecast: RevenueForecastPoint[];
  growthRate: number;
  peakDays: string[];
  alerts: {
    type: string;
    message: string;
  }[];
}

interface BudgetAllocation {
  channel: string;
  currentSpend: number;
  recommendedSpend: number;
  expectedROI: number;
  confidence: number;
}

@Injectable()
export class DecisionEngineService {
  private readonly logger = new Logger(DecisionEngineService.name);

  constructor(
    private readonly revenueIntelligence: RevenueIntelligenceService,
  ) {}

  /**
   * موتور تصمیم‌گیری استراتژیک Yarsalam
   *
   * جریان:
   * Revenue Intelligence
   *        ↓
   * LTV / Forecast / Anomaly
   *        ↓
   * Budget / Content / Alerts
   */
  async getStrategicDecisions() {
    try {
      // ---------------------------------------------------------
      // 1. LTV بر اساس کانال جذب
      // ---------------------------------------------------------
      const ltvByChannel = await this.revenueIntelligence.getLTVByChannel();

      // ---------------------------------------------------------
      // 2. پیش‌بینی درآمد
      // ---------------------------------------------------------
      const forecast = (await this.revenueIntelligence.forecastRevenue(
        90,
      )) as RevenueForecastResult;

      // ---------------------------------------------------------
      // 3. تخصیص بودجه
      // ---------------------------------------------------------
      const budgetAllocation = this.optimizeBudget(
        ltvByChannel,
        forecast.forecast,
      );

      // ---------------------------------------------------------
      // 4. اولویت محتوایی
      // ---------------------------------------------------------
      const contentPriorities = await this.generateContentPriorities();

      // ---------------------------------------------------------
      // 5. هشدارهای درآمدی
      // ---------------------------------------------------------
      const alerts = await this.detectAlerts();

      // ---------------------------------------------------------
      // 6. خلاصه Forecast
      // ---------------------------------------------------------
      const forecastSummary = this.buildForecastSummary(forecast.forecast);

      return {
        budgetAllocation,
        contentPriorities,
        alerts,

        forecast: {
          ...forecastSummary,
          growthRate: forecast.growthRate,
          peakDays: forecast.peakDays,
          modelAlerts: forecast.alerts,
        },
      };
    } catch (error) {
      this.logger.error(
        'Failed to generate strategic decisions',
        error instanceof Error ? error.stack : String(error),
      );

      throw error;
    }
  }

  // ============================================================
  // Budget Optimization
  // ============================================================

  private optimizeBudget(
    ltvByChannel: Record<string, LtvChannel>,
    forecast: RevenueForecastPoint[],
  ): BudgetAllocation[] {
    const totalBudget = 10_000;
    const channels = Object.entries(ltvByChannel);
    if (!channels.length) {
      return [];
    }
    const averageForecastRevenue =
      forecast.length > 0
        ? forecast.reduce((sum, point) => sum + Number(point.revenue || 0), 0) /
          forecast.length
        : 0;
    return channels
      .sort(([, a], [, b]) => b.ltv - a.ltv)
      .map(([source, channel], index) => {
        const currentSpend =
          channel.averageLtv > 0
            ? Math.max(channel.averageLtv * 0.1, 500)
            : 500;
        const expectedROI =
          channel.averageLtv > 0
            ? channel.averageLtv / Math.max(currentSpend, 1)
            : 0;
        const rankWeight = 1 / (index + 1);
        const forecastFactor =
          averageForecastRevenue > 0
            ? Math.min(Math.max(averageForecastRevenue / 10_000, 0.5), 2)
            : 1;
        const recommendedSpend =
          totalBudget * rankWeight * 0.5 * Math.min(forecastFactor, 1.5);
        return {
          channel: source,
          currentSpend,
          recommendedSpend: Math.round(recommendedSpend * 100) / 100,
          expectedROI: Math.round(expectedROI * 100) / 100,
          confidence: Math.max(0.5, Math.min(0.95, 0.9 - index * 0.1)),
        };
      });
  }

  // ============================================================
  // Content Priorities
  // ============================================================

  private async generateContentPriorities() {
    /**
     * فعلاً این قسمت placeholder است.
     *
     * در مرحله بعد باید از:
     * - SEO intelligence
     * - user behavior
     * - search intent
     * - conversion
     * - revenue
     *
     * تغذیه شود.
     */

    return [
      {
        topic: 'high_intent_matchmaking',
        priority: 0.9,
        reason: 'High conversion potential',
      },
      {
        topic: 'profile_completion',
        priority: 0.8,
        reason: 'Improves matching quality and retention',
      },
    ];
  }

  // ============================================================
  // Revenue Alerts
  // ============================================================

  private async detectAlerts() {
    const anomalies = await this.revenueIntelligence.detectAnomalies();

    if (!Array.isArray(anomalies)) {
      return [];
    }

    return anomalies.map((anomaly: any) => ({
      type: anomaly.type ?? 'revenue_anomaly',
      message:
        anomaly.message ?? anomaly.description ?? 'Revenue anomaly detected',
    }));
  }

  // ============================================================
  // Forecast Summary
  // ============================================================

  private buildForecastSummary(forecast: RevenueForecastPoint[]) {
    if (!forecast.length) {
      return {
        nextMonth: 0,
        nextQuarter: 0,
        averageDailyRevenue: 0,
        confidence: 0,
      };
    }

    const revenues = forecast.map((point) => Number(point.revenue || 0));

    const totalRevenue = revenues.reduce((sum, value) => sum + value, 0);

    const averageDailyRevenue = totalRevenue / revenues.length;

    const nextMonth = revenues
      .slice(0, Math.min(30, revenues.length))
      .reduce((sum, value) => sum + value, 0);

    const nextQuarter = totalRevenue;

    const confidenceValues = forecast.map((point) => {
      const [low, high] = point.confidence ?? [0, 0];

      if (high <= 0) {
        return 0;
      }

      /**
       * هرچه فاصله confidence interval کمتر باشد،
       * confidence بیشتر است.
       */
      const intervalWidth = Math.max(high - low, 0);
      const midpoint = Math.max((high + low) / 2, 1);

      return Math.max(0, Math.min(1, 1 - intervalWidth / midpoint));
    });

    const confidence =
      confidenceValues.length > 0
        ? confidenceValues.reduce((sum, value) => sum + value, 0) /
          confidenceValues.length
        : 0;

    return {
      nextMonth: Math.round(nextMonth * 100) / 100,

      nextQuarter: Math.round(nextQuarter * 100) / 100,

      averageDailyRevenue: Math.round(averageDailyRevenue * 100) / 100,

      confidence: Math.round(confidence * 100) / 100,
    };
  }
}
