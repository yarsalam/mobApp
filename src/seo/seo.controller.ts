import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { SEOActivity } from './entities/seo-activity.entity';
import { CampaignSEOService } from './services/campaign-seo.service';
import { SEOCollectorService } from './services/seo-collector.service';
import { SEORetentionService } from './services/analytics/seo-retention.service';
import { SEOService } from './services/seo.service';
import { ContentOpportunityService } from './services/intelligence/content-opportunity.service';
import { RevenueIntelligenceService } from 'src/revenue/revenue-intelligence.service';
import { AutoScalingService } from './services/intelligence/auto-scaling.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SEORecommendation } from './entities/seo-recommendation.entity';
import { AutoExecutorService } from './services/intelligence/auto-executor.service';
import { RevenueAttributionService } from 'src/revenue/revenue-attribution.service';
import { SEOScoreEngine } from './services/seo-score-engine.service';

@ApiTags('seo')
@Controller('seo')
@UseGuards(JwtAuthGuard)
export class SEOController {
  constructor(
    @InjectRepository(SEORecommendation)
    private seoRecommendationRepo: Repository<SEORecommendation>,

    private readonly seoCollector: SEOCollectorService,
    private readonly campaignService: CampaignSEOService,
    private readonly seoRetentionService: SEORetentionService,
    private readonly seoService: SEOService,
    private readonly contentOpportunity: ContentOpportunityService,
    private readonly revenueIntelligence: RevenueIntelligenceService,
    private readonly revenueAttribution: RevenueAttributionService,
    private readonly autoScaling: AutoScalingService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly autoExecutor: AutoExecutorService,
    private readonly seoScoreEngine: SEOScoreEngine,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'دریافت داشبورد سئو' })
  async getDashboard() {
    const metrics = await this.seoCollector.collectAllMetrics();
    return {
      success: true,
      data: metrics,
    };
  }

  @Get('revenue-dashboard')
  @ApiOperation({ summary: 'داشبورد درآمدی سئو' })
  async getRevenueDashboard(): Promise<{
    success: boolean;
    data: any;
  }> {
    // دریافت متریک‌های پایه
    const metrics = await this.seoCollector.collectAllMetrics();
    const score = this.seoScoreEngine.calculateOverallScore(metrics);
    // دریافت LTV by source
    const attribution = await this.revenueAttribution.calculateLTVBySource();

    // دریافت فرصت‌های محتوایی
    const opportunities = await this.contentOpportunity.generateContentIdeas();

    // دریافت توصیه‌های scaling
    const scaling = await this.autoScaling.calculateOptimalResources({
      userCount:
        metrics?.user?.topCities?.reduce((sum, c) => sum + c.count, 0) || 0,
      revenue: metrics?.campaign?.totalRevenue || 0,
      serverLoad: 50, // TODO: از سرویس مانیتورینگ
      growthRate: metrics?.campaign?.growthRate || 0,
      seoScore: score.effective || 0,
    });

    // پیش‌بینی‌ها از AI (اگه فعال باشه)
    let forecast = null;
    const aiUrl = this.configService.get('AI_SEO_URL');

    if (aiUrl) {
      try {
        const response = await firstValueFrom(
          this.httpService.get(`${aiUrl}/api/forecast`),
        );
        forecast = response.data;
      } catch (error: unknown) {
        // ignore
      }
    }

    const userCount =
      metrics?.user?.topCities?.reduce((sum, city) => sum + city.count, 0) ?? 0;
    const totalRevenue = metrics?.campaign?.totalRevenue ?? 0;
    const revenuePerUser = userCount > 0 ? totalRevenue / userCount : 0;

    return {
      success: true,
      data: {
        summary: {
          totalRevenue: metrics?.campaign?.totalRevenue || 0,
          seoScore: score.effective || 0,
          growthRate: metrics?.campaign?.growthRate || 0,
          revenuePerUser,
        },
        attribution: {
          bySource: attribution,
          bestSource: attribution.sort((a, b) => b.ltv - a.ltv)[0],
          averageLTV:
            attribution.length > 0
              ? attribution.reduce((sum, a) => sum + a.ltv, 0) /
                attribution.length
              : 0,
        },
        forecast: forecast || {
          nextMonth: (metrics?.campaign?.totalRevenue ?? 0) * 1.1,
          growthRate: 0.1,
          peakPeriods: ['تابستان', 'پاییز'],
          alerts: [],
        },
        opportunities: opportunities.slice(0, 5),
        scaling: scaling,
        recommendations: score.recommendations || [],
      },
    };
  }

  @Post('activity')
  @ApiOperation({ summary: 'ثبت فعالیت سئو' })
  async createActivity(@Body() activity: Partial<SEOActivity>) {
    const result = await this.campaignService.createActivity(activity);
    return {
      success: true,
      data: result,
    };
  }

  @Get('recommendations')
  @ApiOperation({ summary: 'دریافت پیشنهادات سئو' })
  async getRecommendations() {
    const metrics = await this.seoCollector.collectAllMetrics();
    const score = this.seoScoreEngine.calculateOverallScore(metrics);
    return {
      success: true,
      data: { recommendations: score.recommendations ?? [] },
    };
  }

  // در SEOController
  @Get('admin/dashboard')
  async getAdminDashboard() {
    const [overall, retention, keywords, opportunities, forecast] =
      await Promise.all([
        this.seoCollector.collectAllMetrics(),
        this.seoRetentionService.getKeywordRetentionReport(),
        this.seoService.discoverBehavioralKeywords(),
        this.contentOpportunity.generateHighIntentContent(),
        this.revenueIntelligence.forecastRevenue(90),
      ]);
    const overallScore = this.seoScoreEngine.calculateOverallScore(overall);
    const microBriefs = await this.seoService.discoverBehavioralKeywords();
    return {
      success: true,
      data: {
        // 1. وضعیت کلی
        overall: {
          score: overallScore.overall,
          technical: overall?.technical ?? 0,
          userSignals: overall?.user ?? 0,
          campaigns: overall?.campaign ?? 0,
          competitors: overall?.competitor ?? 0,
        },

        // 2. retention بر اساس کلمه کلیدی
        retentionByKeyword: retention.slice(0, 10),

        // 3. کلمات کلیدی رفتاری جدید
        behavioralKeywords: keywords.slice(0, 20),

        // 4. فرصت‌های محتوایی با LTV بالا
        contentOpportunities: opportunities,

        // 5. پیش‌بینی درآمد
        revenueForecast: forecast,

        // 6. توصیه‌های هوشمند (استاد به ادمین)
        recommendations: [
          {
            title: 'کلمات کلیدی با retention بالا',
            description: `"${retention[0]?.keyword}" با retention ۳۰ روزه ${(retention[0]?.retention30d * 100).toFixed(1)}%`,
            action: 'تولید محتوای بیشتر در این حوزه',
            impact: 'افزایش ۲۵٪ retention',
          },
          {
            title: 'فرصت محتوایی جدید',
            description: `"${opportunities[0]?.keyword}" با LTV تخمینی ${opportunities[0]?.expectedLTV} دلار`,
            action: 'ساخت لندینگ‌پیج اختصاصی',
            impact: 'افزایش ۴۰٪ conversion',
          },
          {
            title: 'بهبود فنی',
            description: `LCP: ${overall?.technical?.lcp ?? 'نامشخص'}ms (هدف < ۲۵۰۰ms)`,
            action: 'بهینه‌سازی سرعت بارگذاری',
            impact: 'افزایش ۱۵٪ رتبه',
          },
        ],

        // 7. درس‌های آموخته شده (دانشجو به استاد)
        learnings: [
          'کاربرانی که از کلمات کلیدی مرتبط با "رابطه جدی" می‌آیند، ۳ برابر بیشتر خرید می‌کنند',
          'محتوای محلی برای شهرهای کوچک retention ۵۰٪ بالاتر دارد',
          'پست‌های اینستاگرام با موضوع "داستان موفقیت" best ROI رو دارن',
          microBriefs.slice(0, 5).map((b) => b.recommendation),
        ],
      },
    };
  }

  @Post('execute-recommendation/:id')
  async executeRecommendation(@Param('id') id: number) {
    const rec = await this.seoRecommendationRepo.findOne({ where: { id } });
    if (!rec) throw new NotFoundException();
    await this.autoExecutor.executeRecommendation(rec);
    return { status: 'executed' };
  }
}
