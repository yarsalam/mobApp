import { Injectable, Logger } from '@nestjs/common';
import { PaymentCurrency } from '../payments/entities/payment.entity';
import {
  RevenueIntelligenceService,
  LtvChannel,
  RevenueForecastPoint,
  RevenueForecastResult,
} from './revenue-intelligence.service';

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
  async getStrategicDecisions(currency: PaymentCurrency = 'IRT') {
    try {
      // ---------------------------------------------------------
      // 1. LTV بر اساس کانال جذب
      // ---------------------------------------------------------
      const ltvByChannel =
        await this.revenueIntelligence.getLTVByChannel(currency);

      // ---------------------------------------------------------
      // 2. پیش‌بینی درآمد
      // ---------------------------------------------------------
      const forecast: RevenueForecastResult =
        await this.revenueIntelligence.forecastRevenue(90, currency);

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
      const alerts = await this.detectAlerts(currency);

      // ---------------------------------------------------------
      // 6. خلاصه Forecast
      // ---------------------------------------------------------
      const forecastSummary = this.buildForecastSummary(forecast.forecast);

      return {
        currency,
        budgetAllocation,
        contentPriorities,
        alerts,

        forecast: {
          ...forecastSummary,
          currency,
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
    _ltvByChannel: Record<string, LtvChannel>,
    _forecast: RevenueForecastPoint[],
  ): BudgetAllocation[] {
    this.logger.warn(
      'Budget allocation unavailable: currency-aligned acquisition cost data is required.',
    );

    return [];
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

  private async detectAlerts(currency: PaymentCurrency) {
    const anomalies = await this.revenueIntelligence.detectAnomalies(currency);

    if (!Array.isArray(anomalies)) {
      return [];
    }

    return anomalies.map((anomaly) => ({
      type: anomaly.type,
      message: anomaly.message,
      currency: anomaly.currency,
      severity: anomaly.severity,
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
