import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SEOActivity } from '../entities/seo-activity.entity';
import { SEOMetrics } from '../entities/seo-metrics.entity';
import { ConfigService } from '@nestjs/config';
import { FeatureStoreRevenueService } from 'src/feature-store-rvenue/feature-store-rvenue.service';
import { ExternalSEOToolsService } from './external-seo-tools.service';

function extractKeywords(content?: string): string[] {
  if (!content) return [];
  return content
    .split(' ')
    .filter((w) => w.length > 4)
    .slice(0, 10);
}

@Injectable()
export class CampaignSEOService {
  private readonly logger = new Logger(CampaignSEOService.name);

  constructor(
    @InjectRepository(SEOActivity)
    private readonly activityRepo: Repository<SEOActivity>,
    @InjectRepository(SEOMetrics)
    private readonly metricsRepo: Repository<SEOMetrics>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly featureStore: FeatureStoreRevenueService,
    private readonly externalTools: ExternalSEOToolsService,
  ) {}

  async analyzeCampaigns() {
    try {
      const activities = await this.activityRepo.find({
        where: {
          performedAt: MoreThan(
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          ),
        },
      });

      if (activities.length === 0) {
        return null;
      }
      for (const a of activities) {
        // <-- این حلقه رو اضافه کن

        const targetKeyword = extractKeywords(a.content)[0];
        if (targetKeyword) {
          // استفاده از SerpAPI برای یافتن رتبه
          const serpData = await this.externalTools.getLiveSerpRanking(
            targetKeyword,
            'yourdomain.com',
          );
          a.aiScore = serpData?.position > 10 ? 0.5 : 0.8;
        }
      }
      // محاسبه ROI
      const campaigns = activities.map((act) => ({
        ...act,
        roi: act.results.revenue - act.cost,
        roi_percentage:
          act.cost > 0 ? (act.results.revenue / act.cost) * 100 : 0,
      }));

      // ارسال به AI برای پیش‌بینی (اگه فعال باشه)
      let aiPredictions = null;
      const aiUrl = this.configService.get('AI_SEO_URL');

      if (aiUrl) {
        try {
          const response = await firstValueFrom(
            this.httpService.post(`${aiUrl}/api/predict-campaign`, {
              activities: activities.map((a) => ({
                platform: a.platform,
                cost: a.cost,
                content: a.content,
                targetAudience: a.targetAudience,
                performedAt: a.performedAt,
                keyword_difficulty: 50, // TODO: از جای دیگه بیار
                content_length: a.content?.length || 500,
                conversion_days: 30, // TODO: محاسبه کن
              })),
            }),
          );

          aiPredictions = response.data;
          this.logger.log('AI predictions received');
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(`AI prediction failed: ${message}`);
        }
      }

      // رتبه‌بندی
      const topCampaigns = campaigns
        .sort((a, b) => b.roi_percentage - a.roi_percentage)
        .slice(0, 5);

      const metrics = {
        totalSpent: activities.reduce((sum, a) => sum + a.cost, 0),
        totalRevenue: activities.reduce((sum, a) => sum + a.results.revenue, 0),
        avgROI:
          campaigns.reduce((sum, a) => sum + a.roi_percentage, 0) /
          campaigns.length,
        topCampaigns,
        byPlatform: this.groupByPlatform(activities),
        aiPredictions,
        timestamp: new Date(),
        //TODO
        growthRate: 0,
      };
      const aiSeoUrl = this.configService.get(
        'AI_SEO_URL',
        'http://ai_seo:8021',
      );
      try {
        await firstValueFrom(
          this.httpService.post('aiSeoUrl/feedback/campaign', {
            campaigns: activities.map((a) => ({
              type: a.type,
              cost: a.cost,
              results: a.results,
              roi: a.roi,
            })),
          }),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error('AI feedback failed', msg);
      }

      if (!aiPredictions) {
        return {
          ...metrics,
          isSimulated: true,
          simulationReason: 'AI service unavailable',
        };
      }
      // ذخیره
      await this.metricsRepo.save({
        metricDate: new Date(),
        type: 'campaign',
        data: metrics,
        score: metrics.avgROI,
      });

      return metrics;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Campaign analysis failed: ${message}`);
      return null;
    }
  }

  private groupByPlatform(activities: SEOActivity[]) {
    const groups: Record<
      string,
      { count: number; revenue: number; cost: number }
    > = {};

    for (const act of activities) {
      if (!groups[act.platform]) {
        groups[act.platform] = { count: 0, revenue: 0, cost: 0 };
      }
      groups[act.platform].count++;
      groups[act.platform].revenue += act.results.revenue;
      groups[act.platform].cost += act.cost;
    }

    return groups;
  }

  async createActivity(dto: Partial<SEOActivity>) {
    const activity = this.activityRepo.create(dto);
    return this.activityRepo.save(activity);
  }

  async getAllActivities(): Promise<SEOActivity[]> {
    return this.activityRepo.find({
      order: { performedAt: 'DESC' },
      take: 100,
    });
  }
}
