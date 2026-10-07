import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { SEOCollectorService } from '../../../seo/services/seo-collector.service';
import { SEOService } from '../../../seo/services/seo.service';
import { SEORetentionService } from '../../../seo/services/analytics/seo-retention.service';
import { ContentOpportunityService } from '../../../seo/services/intelligence/content-opportunity.service';
import { RevenueIntelligenceService } from '../../../revenue/revenue-intelligence.service';
import { RevenueAttributionService } from 'src/revenue/revenue-attribution.service';
import { ExternalSEOToolsService } from 'src/seo/services/external-seo-tools.service';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { SEOMetrics } from 'src/seo/entities/seo-metrics.entity';
import { User } from 'src/users/entities/user.entity';
import { Payment } from 'src/payments/entities/payment.entity';
import { SEOScoreEngine } from 'src/seo/services/seo-score-engine.service';
import { SeoRecommenderService } from 'src/seo/services/seo-recommender.service';
import { BacklinkQualityService } from 'src/seo/services/backlink-quality.service';

@Controller('admin-api/seo')
@UseGuards(AdminApiGuard)
export class AdminApiSeoController {
  private readonly logger = new Logger(AdminApiSeoController.name);
  private readonly aiSeoUrl: string;

  constructor(
    private readonly seoCollector: SEOCollectorService,
    private readonly seoRetentionService: SEORetentionService,
    private readonly seoService: SEOService,
    private readonly contentOpportunity: ContentOpportunityService,
    private readonly revenueIntelligence: RevenueIntelligenceService,
    private readonly revenueAttribution: RevenueAttributionService,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly externalTools: ExternalSEOToolsService,
    private readonly seoScoreEngine: SEOScoreEngine,
    private readonly recommenderService: SeoRecommenderService,
    private readonly backlinkQualityService: BacklinkQualityService,

    @InjectRepository(SEOMetrics)
    private readonly seoMetricsRepo: Repository<SEOMetrics>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
  ) {
    this.aiSeoUrl = this.config.get('AI_SEO_URL') || 'http://ai_seo:8021';
  }

  @Get('dashboard')
  async getDashboard() {
    const metrics = await this.seoCollector.collectAllMetrics();
    return metrics;
  }

  @Get('recommendations')
  async getRecommendations() {
    try {
      const metrics = await this.seoCollector.collectAllMetrics();
      const score = this.seoScoreEngine.calculateOverallScore(metrics);
      return score.recommendations;
    } catch (error: unknown) {
      this.logger.error('SEO recommendations failed', error);
      return [];
    }
  }

  @Get('funnel')
  async getFunnel() {
    try {
      const since = new Date(Date.now() - 30 * 86_400_000);

      const organicSources = ['organic', 'google', 'bing', 'yahoo', 'search'];

      const [searchConsole, registrations, paidUsers, revenueRow] =
        await Promise.all([
          // Google Search Console
          this.externalTools
            .getSearchConsoleData(process.env.GOOGLE_SEARCH_CONSOLE_SITE, 30)
            .catch(() => null),

          // Organic registrations
          this.userRepo
            .createQueryBuilder('u')
            .where('u.acquisitionSource IN (:...sources)', {
              sources: organicSources,
            })
            .andWhere('u.createdAt > :since', {
              since,
            })
            .getCount()
            .catch(() => 0),

          // Organic paying users
          this.userRepo
            .createQueryBuilder('u')
            .where('u.acquisitionSource IN (:...sources)', {
              sources: organicSources,
            })
            .andWhere('u.tier != :tier', {
              tier: 'free',
            })
            .andWhere('u.createdAt > :since', {
              since,
            })
            .getCount()
            .catch(() => 0),

          // Organic revenue
          this.paymentRepo
            .createQueryBuilder('p')
            .innerJoin('p.user', 'u')
            .where('u.acquisitionSource IN (:...sources)', {
              sources: organicSources,
            })
            .andWhere('p.status = :status', {
              status: 'paid',
            })
            .andWhere('p.createdAt > :since', {
              since,
            })
            .select('COALESCE(SUM(p.amount),0)', 'total')
            .getRawOne()
            .catch(() => ({
              total: '0',
            })),
        ]);

      return {
        steps: [
          {
            step: 'impressions',
            label: 'نمایش در جستجو',
            count: searchConsole?.totalImpressions ?? 0,
          },
          {
            step: 'clicks',
            label: 'کلیک',
            count: searchConsole?.totalClicks ?? 0,
          },
          {
            step: 'registrations',
            label: 'ثبت‌نام (منبع ارگانیک)',
            count: registrations,
          },
          {
            step: 'paid',
            label: 'کاربر پرداخت‌کننده',
            count: paidUsers,
          },
        ],

        revenue30d: Number(revenueRow?.total || 0),

        impressionsClicksEstimated: !process.env.GOOGLE_API_KEY,
      };
    } catch (error) {
      this.logger.error('SEO funnel failed', error);

      return {
        steps: [
          {
            step: 'impressions',
            label: 'نمایش در جستجو',
            count: 0,
          },
          {
            step: 'clicks',
            label: 'کلیک',
            count: 0,
          },
          {
            step: 'registrations',
            label: 'ثبت‌نام (منبع ارگانیک)',
            count: 0,
          },
          {
            step: 'paid',
            label: 'کاربر پرداخت‌کننده',
            count: 0,
          },
        ],
        revenue30d: 0,
        impressionsClicksEstimated: true,
      };
    }
  }

  @Get('trends-mom')
  async getTrendsMoM() {
    try {
      const monthAgo = new Date(Date.now() - 30 * 86_400_000);
      const findClosest = (type: string) =>
        this.seoMetricsRepo
          .createQueryBuilder('m')
          .where('m.type = :type', { type })
          .andWhere('m.metricDate <= :d', { d: monthAgo })
          .orderBy('m.metricDate', 'DESC')
          .getOne();

      // بعد:
      const [current, prevTechnical, prevCampaign] = await Promise.all([
        this.seoCollector.collectAllMetrics(),
        findClosest('technical'),
        findClosest('campaign'),
      ]);

      const currentScore = this.seoScoreEngine.calculateOverallScore(current);

      const pctDelta = (curr: number, prev?: number | null) =>
        prev ? Math.round(((curr - prev) / prev) * 1000) / 10 : null;

      const currCampaignRevenue = current?.campaign?.totalRevenue ?? 0;
      const prevCampaignRevenue =
        (prevCampaign?.data as any)?.totalRevenue ?? null;
      const currTechnicalScore = currentScore?.breakdown?.technical ?? 0;

      return {
        campaignRevenue: {
          current: currCampaignRevenue,
          previous: prevCampaignRevenue,
          deltaPercent: pctDelta(currCampaignRevenue, prevCampaignRevenue),
        },
        technicalScore: {
          current: currTechnicalScore,
          previous: prevTechnical?.score ?? null,
          deltaPercent: pctDelta(currTechnicalScore, prevTechnical?.score),
        },
      };
    } catch (error: unknown) {
      this.logger.error('SEO MoM trends failed', error);
      return { campaignRevenue: null, technicalScore: null };
    }
  }

  @Get('traffic-proxy-history')
  async getTrafficProxyHistory(@Query('days') days?: string) {
    try {
      const n = Math.min(365, Math.max(14, Number(days) || 90));
      const rows = await this.userRepo
        .createQueryBuilder('u')
        .select('DATE(u.createdAt)', 'date')
        .addSelect('COUNT(*)', 'count')
        .where('u.createdAt > :since', {
          since: new Date(Date.now() - n * 86_400_000),
        })
        .groupBy('date')
        .orderBy('date', 'ASC')
        .getRawMany();

      return rows.map((r) => ({
        date: r.date,
        traffic: parseInt(r.count, 10),
      }));
    } catch (error: unknown) {
      this.logger.error('Traffic proxy history failed', error);
      return [];
    }
  }

  @Get('revenue-dashboard')
  async getRevenueDashboard() {
    const attribution = await this.revenueAttribution.calculateLTVBySource();
    return attribution;
  }

  @Get('behavioral-keywords')
  async getBehavioralKeywords() {
    return this.seoService.discoverBehavioralKeywords();
  }

  @Get('admin-dashboard')
  async getAdminDashboard() {
    // تجمیع داده‌ها از سرویس‌ها - هر کدوم در try/catch خودش
    const [overall, retention, keywords, opportunities, forecastResult] =
      await Promise.all([
        this.seoCollector.collectAllMetrics().catch((e) => {
          this.logger.error('collectAllMetrics failed', e);
          return null;
        }),
        this.seoRetentionService.getKeywordRetentionReport().catch((e) => {
          this.logger.error('getKeywordRetentionReport failed', e);
          return [];
        }),
        this.seoService.discoverBehavioralKeywords().catch((e) => {
          this.logger.error('discoverBehavioralKeywords failed', e);
          return [];
        }),
        this.contentOpportunity.generateHighIntentContent().catch((e) => {
          this.logger.error('generateHighIntentContent failed', e);
          return [];
        }),
        this.revenueIntelligence.forecastRevenue(90).catch((e) => {
          this.logger.error('forecastRevenue failed', e);
          return null;
        }),
      ]);
    const overallScore = overall
      ? this.seoScoreEngine.calculateOverallScore(overall)
      : null;

    // ۱. استخراج داده‌های کمپین و رقبا (با نام صحیح)
    const campaign = overall?.campaign; // مفرد از collector
    const competitor = overall?.competitor; // مفرد از collector

    // ۲. استخراج nextMonth از forecast آرایه‌ای
    const forecastArray = forecastResult?.forecast; // آرایه پیش‌بینی
    const nextMonthRevenue = forecastArray?.length
      ? forecastArray[0].revenue
      : 0;

    // ۳. ساخت پاسخ نهایی
    return {
      overall: {
        score: overallScore ?? {
          overall: 0,
          effective: 0,
          grade: 'N/A',
          breakdown: {},
          recommendations: [],
        },
        technical: {
          lcp: overall?.technical?.lcp ?? 0,
          cls: overall?.technical?.cls ?? 0,
          fid: overall?.technical?.fid ?? 0,
          mobileScore: overall?.technical?.mobileScore ?? 0,
          crawlErrors: overall?.technical?.crawlErrors ?? 0,
          brokenLinks: overall?.technical?.brokenLinks ?? 0,
        },
        campaigns: {
          totalRevenue: campaign?.totalRevenue ?? 0,
          avgROI: campaign?.avgROI ?? 0,
          growthRate: campaign?.growthRate ?? 0,
          totalSpent: campaign?.totalSpent ?? 0,
        },
        competitors: {
          threats: competitor?.threats ?? [],
        },
      },
      retentionByKeyword: retention,
      behavioralKeywords: keywords,
      contentOpportunities: opportunities,
      revenueForecast: {
        nextMonth: nextMonthRevenue,
        growthRate: forecastResult?.growthRate ?? 0,
      },
      recommendations: [],
      learnings: [],
    };
  }

  @Get('content-opportunities')
  async getContentOpportunities() {
    return this.contentOpportunity.generateHighIntentContent();
  }

  @Get('competitor-analysis')
  async getCompetitorAnalysis() {
    // موقتاً mock – بعداً می‌توان از سرویس واقعی استفاده کرد
    return [
      { competitor: 'رقیب ۱', overlap: 30, strength: ['بک‌لینک', 'سرعت'] },
      { competitor: 'رقیب ۲', overlap: 20, strength: ['محتوا'] },
    ];
  }

  // @Get('competitor-changes')
  // async getCompetitorChanges() {
  //   try {
  //     const { data } = await this.httpService.axiosRef.get(
  //       `${this.aiSeoUrl}/competitor-changes`,
  //     );
  //     return data;
  //   } catch (error: unknown) {
  //     this.logger.error('Failed to fetch competitor changes', error);
  //     return [];
  //   }
  // }

  // @Get('serp-features')
  // async getSERPFeatures(@Query('keyword') keyword: string) {
  //   try {
  //     const { data } = await this.httpService.axiosRef.get(
  //       `${this.aiSeoUrl}/serp-features?keyword=${encodeURIComponent(keyword)}`,
  //     );
  //     return data;
  //   } catch (error: unknown) {
  //     this.logger.error('Failed to fetch SERP features', error);
  //     return [];
  //   }
  // }

  // @Get('keywords-ranking')
  // async getKeywordsRanking() {
  //   return this.seoService.discoverBehavioralKeywords();
  // }

  // @Get('keywords-ranking')
  // async getKeywordsRanking() {
  //   try {
  //     return await this.seoService.discoverBehavioralKeywords();
  //   } catch (error: unknown) {
  //     this.logger.error('SEO keywords ranking failed, returning mock', error);
  //     // داده‌های Mock برای نمایش در پنل
  //     return [
  //       { keyword: 'همسریابی', position: 3, volume: 12000, trend: 'up' },
  //       { keyword: 'دوستیابی', position: 8, volume: 8000, trend: 'stable' },
  //       { keyword: 'ازدواج', position: 12, volume: 15000, trend: 'down' },
  //     ];
  //   }
  // }

  // @Get('competitor-changes')
  // async getCompetitorChanges() {
  //   try {
  //     const { data } = await this.httpService.axiosRef.get(
  //       `${this.aiSeoUrl}/competitor-changes`,
  //     );
  //     return data;
  //   } catch (error: unknown) {
  //     this.logger.error('Competitor changes fetch failed');
  //     return [];
  //   }
  // }

  @Get('serp-features')
  async getSERPFeatures(@Query('keyword') keyword: string) {
    try {
      const { data } = await this.httpService.axiosRef.get(
        `${this.aiSeoUrl}/serp-features?keyword=${encodeURIComponent(keyword)}`,
      );
      return data;
    } catch (error: unknown) {
      this.logger.error('SERP features fetch failed', error);
      return []; // یا یک Mock مناسب
    }
  }

  @Get('full-score')
  async getFullScore() {
    const metrics = await this.seoCollector.collectAllMetrics();
    const score = this.seoScoreEngine.calculateOverallScore(metrics);
    return { success: true, data: { metrics, score } };
  }

  @Get('recommendations/personalized')
  async getPersonalizedRecommendations(@Query('userId') userId: string) {
    const data = await this.recommenderService.recommend(userId, 5);
    return { success: true, data };
  }

  @Get('backlink-quality')
  async getBacklinkQuality(@Query('domain') domain: string) {
    const data = await this.backlinkQualityService.health();
    return { success: true, data };
  }

  @Get('google-trends')
  async getGoogleTrends(
    @Query('keyword') keyword: string,
    @Query('geo') geo?: string,
  ) {
    return this.externalTools.getGoogleTrends(keyword, geo ?? 'IR');
  }

  @Post('keyword-gap')
  async getKeywordGap(@Body() body: { domain: string; competitors: string[] }) {
    return this.externalTools.getKeywordGap(body.domain, body.competitors);
  }

  @Get('keywords-ranking')
  async getKeywordsRanking(@Query('keyword') keyword?: string) {
    // به جای Serper، از GSC استفاده میکنیم
    try {
      const gscData = await this.externalTools.getSearchConsoleData(
        process.env.GOOGLE_SEARCH_CONSOLE_SITE,
        90, // 90 روز گذشته
      );

      if (!gscData?.rows?.length) return [];

      // تبدیل فرمت GSC به فرمت keyword ranking
      const rows = gscData.rows as any[];

      // فیلتر بر اساس keyword اگر داده شده
      const filtered = keyword
        ? rows.filter((r: any) => r.keys?.[0]?.includes(keyword))
        : rows;

      return filtered
        .slice(0, 50)
        .map((r: any) => ({
          keyword: r.keys?.[0] ?? '',
          page: r.keys?.[1] ?? '',
          position: Math.round(r.position ?? 100),
          volume: r.impressions ?? 0,
          clicks: r.clicks ?? 0,
          ctr: r.ctr ?? 0,
          trend: r.position < 15 ? 'up' : r.position > 30 ? 'down' : 'stable',
          difficulty: undefined, // از DataForSEO میاد — اختیاری
        }))
        .sort((a: any, b: any) => a.position - b.position);
    } catch {
      return [];
    }
  }
}
