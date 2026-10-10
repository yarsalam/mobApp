import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AdminApiGuard } from '../../guards/api-key.guard';
import { RevenueIntelligenceService } from '../../../revenue/revenue-intelligence.service';
import { RevenueAttributionService } from '../../../revenue/revenue-attribution.service';
import { RevenueTrendService } from '../../../revenue/revenue-trend.service';
import { PaymentCurrency } from '../../../payments/entities/payment.entity';

const SUPPORTED_CURRENCIES: PaymentCurrency[] = ['IRT', 'USDT', 'BTC', 'USD'];

@Controller('admin-api/revenue')
@UseGuards(AdminApiGuard)
export class AdminApiRevenueController {
  constructor(
    private readonly revenueAttribution: RevenueAttributionService,
    private readonly revenueIntelligence: RevenueIntelligenceService,
    private readonly revenueTrend: RevenueTrendService,
  ) {}

  private parseBoundedInt(
    value: string | undefined,
    defaultValue: number,
    min: number,
    max: number,
    field: string,
  ): number {
    if (value === undefined || value.trim() === '') {
      return defaultValue;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException(
        `${field} must be an integer between ${min} and ${max}`,
      );
    }

    return parsed;
  }

  private parseCurrency(value?: string): PaymentCurrency {
    const currency = value?.trim().toUpperCase() || 'IRT';

    if (!SUPPORTED_CURRENCIES.includes(currency as PaymentCurrency)) {
      throw new BadRequestException(`Unsupported currency: ${currency}`);
    }

    return currency as PaymentCurrency;
  }

  @Get('ltv-by-source')
  async ltvBySource(
    @Query('days') days?: string,
    @Query('currency') currencyInput?: string,
  ) {
    const daysBack = this.parseBoundedInt(days, 90, 1, 3650, 'days');

    const currency = this.parseCurrency(currencyInput);

    const rows = await this.revenueAttribution.calculateLTVBySource(daysBack);

    // LTV ارزهای مختلف نباید با هم رتبه‌بندی یا جمع شوند.
    return rows.filter((row) => row.currency === currency);
  }

  /**
   * درآمد ماهانه بر اساس تقویم شمسی.
   * فقط پرداخت‌های paid و فقط ارز انتخاب‌شده.
   */
  @Get('monthly')
  async monthly(
    @Query('months') months?: string,
    @Query('currency') currencyInput?: string,
  ) {
    const monthsBack = this.parseBoundedInt(months, 12, 1, 60, 'months');

    const currency = this.parseCurrency(currencyInput);

    return this.revenueTrend.getMonthlyTrend(monthsBack, currency);
  }

  /**
   * تاریخچه روزانه برای نمودار و تحلیل روند.
   */
  @Get('historical')
  async historical(
    @Query('days') days?: string,
    @Query('currency') currencyInput?: string,
  ) {
    const daysBack = this.parseBoundedInt(days, 90, 1, 365, 'days');

    const currency = this.parseCurrency(currencyInput);

    return this.revenueTrend.getDailyHistory(daysBack, currency);
  }

  @Get('forecast')
  async forecast(
    @Query('days') days?: string,
    @Query('currency') currencyInput?: string,
  ) {
    const forecastDays = this.parseBoundedInt(days, 90, 1, 365, 'days');

    const currency = this.parseCurrency(currencyInput);

    return this.revenueIntelligence.forecastRevenue(forecastDays, currency);
  }

  /**
   * ناهنجاری‌ها با مقایسه روزها در یک ارز مشخص.
   */
  @Get('anomalies')
  async anomalies(@Query('currency') currencyInput?: string) {
    const currency = this.parseCurrency(currencyInput);
    const history = await this.revenueTrend.getDailyHistory(60, currency);

    if (history.length < 14) {
      return [];
    }

    const anomalies: {
      id: string;
      date: string;
      currency: PaymentCurrency;
      severity: 'low' | 'medium' | 'high';
      description: string;
      actual: number;
      expected: number;
    }[] = [];

    for (let i = 7; i < history.length; i++) {
      const window = history.slice(i - 7, i);

      const average =
        window.reduce((sum, point) => sum + point.amount, 0) / window.length;

      // وقتی baseline صفر است، درصد انحراف معنی ندارد.
      if (average <= 0) {
        continue;
      }

      const actual = history[i].amount;
      const deviation = (actual - average) / average;

      if (Math.abs(deviation) < 0.4) {
        continue;
      }

      const severity: 'low' | 'medium' | 'high' =
        Math.abs(deviation) > 1
          ? 'high'
          : Math.abs(deviation) > 0.6
            ? 'medium'
            : 'low';

      anomalies.push({
        id: `anomaly_${currency}_${history[i].date}`,
        date: history[i].date,
        currency,
        severity,
        description:
          deviation > 0
            ? `درآمد ${Math.round(deviation * 100)}٪ بالاتر از میانگین ۷ روز قبل`
            : `درآمد ${Math.round(Math.abs(deviation) * 100)}٪ پایین‌تر از میانگین ۷ روز قبل`,
        actual,
        expected: Math.round(average),
      });
    }

    return anomalies.slice(-10).reverse();
  }

  /**
   * تصمیم‌های توصیفی مبتنی بر داده‌های هم‌ارز.
   * این endpoint بودجه یا ROI ساختگی تولید نمی‌کند.
   */
  @Get('strategic-decisions')
  async strategicDecisions(@Query('currency') currencyInput?: string) {
    const currency = this.parseCurrency(currencyInput);

    const [monthly, allLtvRows] = await Promise.all([
      this.revenueTrend.getMonthlyTrend(3, currency),
      this.revenueAttribution.calculateLTVBySource(),
    ]);

    const decisions: {
      id: string;
      title: string;
      description: string;
      currency: PaymentCurrency;
      impact: number;
    }[] = [];

    if (monthly.length >= 2) {
      const last = monthly[monthly.length - 1];
      const previous = monthly[monthly.length - 2];

      if (previous.amount > 0) {
        const growth =
          ((last.amount - previous.amount) / previous.amount) * 100;

        if (growth < 0) {
          decisions.push({
            id: 'decision_revenue_decline',
            title: 'بررسی افت درآمد ماه اخیر',
            description:
              `درآمد ${last.month} نسبت به ماه قبل ` +
              `${Math.abs(Math.round(growth))}٪ کاهش داشته است.`,
            currency,
            impact: Math.round(Math.abs(previous.amount - last.amount)),
          });
        } else if (growth > 15) {
          decisions.push({
            id: 'decision_revenue_growth',
            title: 'بررسی عوامل رشد درآمد',
            description:
              `درآمد ${last.month} نسبت به ماه قبل ` +
              `${Math.round(growth)}٪ رشد داشته است.`,
            currency,
            impact: Math.round(last.amount - previous.amount),
          });
        }
      }
    }

    const ltvRows = allLtvRows.filter((row) => row.currency === currency);

    const top = [...ltvRows].sort((a, b) => b.ltv - a.ltv)[0];

    if (top && top.userCount > 0) {
      decisions.push({
        id: 'decision_top_ltv_source',
        title: `بالاترین LTV مشاهده‌شده: ${top.source}`,
        description:
          `میانگین LTV این منبع ${top.ltv} ${currency} ` +
          `برای ${top.userCount} کاربر در بازه محاسبه‌شده است. ` +
          'این شاخص به‌تنهایی اثبات‌کننده ROI یا مناسب‌بودن افزایش بودجه نیست.',
        currency,
        impact: Math.round(top.ltv),
      });
    }

    return {
      currency,
      decisions,
    };
  }
}
