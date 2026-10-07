import { Injectable, Logger } from '@nestjs/common';

export interface SeoRecommendation {
  domain: 'technical' | 'campaign' | 'competitor' | 'user';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impact: string;
}

export interface SeoScoreResult {
  overall: number;
  breakdown: Record<string, number>;
  weights: Record<string, number>;
  effective: number;
  grade: string;
  recommendations: SeoRecommendation[];
}

@Injectable()
export class SEOScoreEngine {
  private readonly logger = new Logger(SEOScoreEngine.name);

  calculateOverallScore(metrics: any): SeoScoreResult {
    const weights = {
      technical: 0.25,
      user: 0.2,
      campaign: 0.15,
      competitor: 0.15,
      aeo: 0.1,
      recommender: 0.05,
      backlink: 0.1,
    };

    const scores: Record<string, number> = {
      technical: metrics.technical?.score ?? 0,
      user: metrics.user?.score ?? 0,
      campaign: metrics.campaign?.score ?? 0,
      competitor: metrics.competitor?.score ?? 0,
      aeo: this.calculateAeoScore(metrics),
      recommender: this.calculateRecommenderScore(metrics),
      backlink: this.calculateBacklinkScore(metrics),
    };

    const overall = Object.keys(weights).reduce(
      (sum, key) => sum + scores[key] * (weights as any)[key],
      0,
    );

    const roundedOverall = Math.round(overall);
    const recommendations = this.generateRecommendations(metrics, scores);

    return {
      overall: roundedOverall,
      breakdown: scores,
      weights,
      effective: roundedOverall,
      grade: this.getGrade(roundedOverall),
      recommendations,
    };
  }

  private generateRecommendations(
    metrics: any,
    scores: Record<string, number>,
  ): SeoRecommendation[] {
    const recs: SeoRecommendation[] = [];

    if (scores.technical < 70) {
      recs.push({
        domain: 'technical',
        priority: scores.technical < 50 ? 'high' : 'medium',
        title: 'بهبود Core Web Vitals',
        description: `نمره فنی سئو ${scores.technical} است — LCP: ${metrics.technical?.lcp ?? '؟'}s`,
        impact: '+۱۵٪ رتبه ارگانیک',
      });
    }

    if ((metrics.technical?.crawlErrors ?? 0) > 0) {
      recs.push({
        domain: 'technical',
        priority: metrics.technical.crawlErrors > 10 ? 'high' : 'medium',
        title: 'رفع خطاهای Crawl',
        description: `${metrics.technical.crawlErrors} خطای crawl شناسایی شده`,
        impact: 'جلوگیری از افت ایندکس',
      });
    }

    if (scores.campaign < 50 && metrics.campaign?.avgROI !== undefined) {
      recs.push({
        domain: 'campaign',
        priority: 'medium',
        title: 'بازبینی کمپین‌های کم‌بازده',
        description: `میانگین ROI کمپین‌ها ${Math.round(metrics.campaign.avgROI ?? 0)}٪ است`,
        impact: 'افزایش بازگشت سرمایه تبلیغات',
      });
    }

    const highThreats = (metrics.competitor?.threats ?? []).filter(
      (t: any) => t.threatLevel === 'high',
    );
    if (highThreats.length > 0) {
      recs.push({
        domain: 'competitor',
        priority: 'high',
        title: `پایش ${highThreats.length} رقیب با تهدید بالا`,
        description: highThreats.map((t: any) => t.name).join('، '),
        impact: 'حفظ سهم بازار',
      });
    }

    if (scores.user < 50) {
      recs.push({
        domain: 'user',
        priority: 'medium',
        title: 'بهبود سیگنال‌های رفتاری کاربر',
        description: `نرخ تعامل ${Math.round((metrics.user?.engagementRate ?? 0) * 100)}٪`,
        impact: 'افزایش retention و سیگنال سئو',
      });
    }

    const order = { high: 0, medium: 1, low: 2 } as const;
    return recs.sort((a, b) => order[a.priority] - order[b.priority]);
  }

  async generateNextAction(score: {
    overall: number;
    breakdown: Record<string, number>;
  }): Promise<{
    priority: 'high' | 'medium' | 'low';
    action: string;
    reason: string;
  }> {
    const entries = Object.entries(score.breakdown);
    const weakest = entries.sort((a, b) => a[1] - b[1])[0];

    const actionMap: Record<string, { action: string; reason: string }> = {
      technical: {
        action: 'رفع خطاهای فنی سئو (سرعت لود، meta tags)',
        reason: 'امتیاز فنی پایین روی رتبه‌بندی اثر می‌گذارد',
      },
      aeo: {
        action: 'بهینه‌سازی محتوا برای پاسخ‌های AI',
        reason: 'برند در موتورهای AI کمتر دیده می‌شود',
      },
      backlink: {
        action: 'شروع کمپین لینک‌سازی',
        reason: 'کیفیت بک‌لینک پایین است',
      },
      competitor: {
        action: 'بررسی استراتژی کلمات کلیدی رقبا',
        reason: 'بیشترین شکاف با رقبا اینجاست',
      },
      recommender: {
        action: 'جمع‌آوری تعاملات بیشتر کاربر',
        reason: 'مدل داده کافی برای پیشنهاد ندارد',
      },
      user: {
        action: 'بهبود نرخ تعامل کاربر با محتوای سئو',
        reason: 'سیگنال‌های کاربری ضعیف است',
      },
      campaign: {
        action: 'بازبینی کمپین‌های کم‌بازده',
        reason: 'بازده محتوایی پایین است',
      },
    };

    const detail = actionMap[weakest[0]] ?? {
      action: 'بررسی داده‌ی سئو',
      reason: 'داده کافی نیست',
    };

    return {
      priority: weakest[1] < 40 ? 'high' : weakest[1] < 70 ? 'medium' : 'low',
      action: detail.action,
      reason: detail.reason,
    };
  }

  private calculateRevenueMultiplier(revenueData: any): number {
    if (!revenueData) return 1;
    const growthRate = revenueData.growthRate || 0;
    const roi = revenueData.roi || 1;
    if (growthRate > 0.2 && roi > 2) return 1.2;
    if (growthRate > 0.1 && roi > 1.5) return 1.1;
    if (growthRate < -0.1) return 0.8;
    return 1;
  }

  private calculateTechnicalScore(metrics: any): number {
    let score = 100;
    if (metrics?.lcp > 2.5) score -= 10;
    if (metrics?.fid > 100) score -= 10;
    if (metrics?.cls > 0.1) score -= 10;
    if (metrics?.crawlErrors > 0) score -= metrics.crawlErrors * 2;
    return Math.max(0, score);
  }

  private calculateUserScore(metrics: any): number {
    let score = 0;
    if (metrics?.engagementRate > 0.3) score += 30;
    if (metrics?.returnRate > 0.4) score += 25;
    if (metrics?.topCities?.length > 5) score += 20;
    if (metrics?.underservedCities?.length > 2) score += 15;
    return Math.min(100, score);
  }

  private calculateCampaignScore(metrics: any): number {
    if (!metrics?.avgROI) return 50;
    const roiScore = Math.min(100, metrics.avgROI);
    const platformCount = Object.keys(metrics.byPlatform || {}).length;
    const diversityScore = Math.min(20, platformCount * 5);
    const consistencyScore = metrics.campaigns?.length > 5 ? 15 : 5;
    return Math.min(100, roiScore * 0.7 + diversityScore + consistencyScore);
  }

  private calculateCompetitorScore(metrics: any): number {
    if (!metrics?.threats) return 50;
    const highThreats = metrics.threats.filter(
      (t) => t.threatLevel === 'high',
    ).length;
    return Math.max(0, 100 - highThreats * 20);
  }

  // ── تبدیل‌شده از class field به متد — قبلاً به متغیر گلوبال ناموجود `metrics` وابسته بود
  private calculateAeoScore(metrics: any): number {
    return metrics.aeo?.mention_rate
      ? Math.round(metrics.aeo.mention_rate * 100)
      : 0;
  }

  // Recommender: صرفاً سلامت مدل (آیا trained است) — سیگنال ساده تا داده‌ی کیفی‌تری جمع شود
  private calculateRecommenderScore(metrics: any): number {
    return metrics.recommender?.model_trained ? 100 : 40;
  }

  // Backlink: میانگین trust score دامنه‌های شناخته‌شده، اگر موجود بود
  private calculateBacklinkScore(metrics: any): number {
    return metrics.backlink?.status === 'healthy' ? 100 : 40;
  }

  private getGrade(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }
}
