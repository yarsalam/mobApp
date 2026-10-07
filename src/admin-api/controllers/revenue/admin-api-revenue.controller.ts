import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { RevenueIntelligenceService } from '../../../revenue/revenue-intelligence.service';
import { RevenueAttributionService } from 'src/revenue/revenue-attribution.service';
import { RevenueTrendService } from 'src/revenue/revenue-trend.service';

@Controller('admin-api/revenue')
@UseGuards(AdminApiGuard)
export class AdminApiRevenueController {
  constructor(
    private readonly revenueAttribution: RevenueAttributionService,
    private readonly revenueIntelligence: RevenueIntelligenceService,
    private readonly revenueTrend: RevenueTrendService,
  ) {}

  @Get('ltv-by-source')
  async ltvBySource() {
    return this.revenueAttribution.calculateLTVBySource();
  }

  /**
   * درآمد ماهانه واقعی (شمسی) — از جدول payments، status='paid' فقط.
   * جایگزین mock سه‌ماهه‌ی قبلی.
   */
  @Get('monthly')
  async monthly(@Query('months') months?: string) {
    const monthsBack = months ? parseInt(months, 10) : 12;
    return this.revenueTrend.getMonthlyTrend(monthsBack);
  }

  /**
   * سری روزانه خام — grain روزانه برای forecast و نمودارهای دقیق‌تر.
   */
  @Get('historical')
  async historical(@Query('days') days?: string) {
    const daysBack = days ? parseInt(days, 10) : 90;
    return this.revenueTrend.getDailyHistory(daysBack);
  }

  @Get('forecast')
  async forecast(@Query('days') days = 90) {
    return this.revenueIntelligence.forecastRevenue(days);
  }

  /**
   * ناهنجاری‌های درآمد — با مقایسه هر روز به میانگین متحرک ۷ روزه‌ی قبل از خودش.
   * انحراف بیش از ۴۰٪ (بالا یا پایین) به‌عنوان anomaly گزارش می‌شود.
   */
  @Get('anomalies')
  async anomalies() {
    const history = await this.revenueTrend.getDailyHistory(60);
    if (history.length < 14) return [];

    const anomalies: {
      id: string;
      date: string;
      severity: 'low' | 'medium' | 'high';
      description: string;
      actual: number;
      expected: number;
    }[] = [];

    for (let i = 7; i < history.length; i++) {
      const window = history.slice(i - 7, i);
      const avg = window.reduce((s, p) => s + p.amount, 0) / window.length;
      if (avg === 0) continue;

      const actual = history[i].amount;
      const deviation = (actual - avg) / avg;

      if (Math.abs(deviation) < 0.4) continue;

      const severity =
        Math.abs(deviation) > 1
          ? ('high' as const)
          : Math.abs(deviation) > 0.6
            ? ('medium' as const)
            : ('low' as const);

      anomalies.push({
        id: `anomaly_${history[i].date}`,
        date: history[i].date,
        severity,
        description:
          deviation > 0
            ? `درآمد ${Math.round(deviation * 100)}٪ بالاتر از میانگین ۷ روز قبل`
            : `درآمد ${Math.round(Math.abs(deviation) * 100)}٪ پایین‌تر از میانگین ۷ روز قبل`,
        actual,
        expected: Math.round(avg),
      });
    }

    return anomalies.slice(-10).reverse();
  }

  /**
   * پیشنهادات استراتژیک — تولید شده از روی روند واقعی MRR و LTV by source.
   */
  @Get('strategic-decisions')
  async strategicDecisions() {
    const [monthly, ltvBySource] = await Promise.all([
      this.revenueTrend.getMonthlyTrend(3),
      this.revenueAttribution.calculateLTVBySource().catch(() => null),
    ]);

    const decisions: {
      id: string;
      title: string;
      description: string;
      impact: number;
      roi: number;
    }[] = [];

    if (monthly.length >= 2) {
      const last = monthly[monthly.length - 1];
      const prev = monthly[monthly.length - 2];
      if (prev.amount > 0) {
        const growth = ((last.amount - prev.amount) / prev.amount) * 100;
        if (growth < 0) {
          decisions.push({
            id: 'decision_revenue_decline',
            title: 'بررسی افت درآمد ماه اخیر',
            description: `درآمد ${last.month} نسبت به ماه قبل ${Math.abs(
              Math.round(growth),
            )}٪ کاهش داشته — بررسی کمپین‌ها و نرخ تبدیل توصیه می‌شود.`,
            impact: Math.round(Math.abs(prev.amount - last.amount)),
            roi: 0,
          });
        } else if (growth > 15) {
          decisions.push({
            id: 'decision_revenue_growth',
            title: 'تثبیت رشد درآمد با افزایش بودجه رشد',
            description: `درآمد ${last.month} نسبت به ماه قبل ${Math.round(
              growth,
            )}٪ رشد داشته — تخصیص بودجه بیشتر به کانال‌های مؤثر می‌تواند این روند را تقویت کند.`,
            impact: Math.round(last.amount * 0.15),
            roi: Math.round(growth),
          });
        }
      }
    }

    if (Array.isArray(ltvBySource) && ltvBySource.length > 0) {
      const sorted = [...ltvBySource].sort(
        (a: any, b: any) => (b.ltv ?? 0) - (a.ltv ?? 0),
      );
      const top = sorted[0] as any;
      if (top?.ltv) {
        decisions.push({
          id: 'decision_top_source',
          title: `تمرکز بیشتر روی منبع با بالاترین LTV: ${top.source ?? 'نامشخص'}`,
          description:
            'این منبع بالاترین ارزش طول عمر کاربر را دارد — افزایش سرمایه‌گذاری در این کانال بازدهی بالاتری نسبت به میانگین دارد.',
          impact: Math.round(top.ltv),
          roi: 0,
        });
      }
    }

    return decisions;
  }
}
