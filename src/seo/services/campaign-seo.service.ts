import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { SEOActivity } from '../entities/seo-activity.entity';

@Injectable()
export class CampaignSEOService {
  constructor(
    @InjectRepository(SEOActivity)
    private readonly activityRepo: Repository<SEOActivity>,
  ) {}

  async analyzeCampaigns() {
    const activities = await this.activityRepo.find({
      where: {
        performedAt: MoreThan(new Date(Date.now() - 30 * 86_400_000)),
      },
      order: { performedAt: 'DESC' },
    });

    return {
      status: 'activity_log_only',
      dataAvailable: true,
      windowDays: 30,
      activityCount: activities.length,
      financialComparison: {
        status: 'unavailable',
        roi: null,
        reason: 'Campaign cost and reported revenue do not have verified, matching currency units.',
      },
      activities: activities.map((activity) => ({
        id: activity.id,
        type: activity.type,
        platform: activity.platform,
        url: activity.url ?? null,
        performedAt: activity.performedAt,
        recordedCost: Number(activity.cost),
        costCurrency: null,
        reportedResults: activity.results ?? null,
        reportedRevenue: activity.results?.revenue ?? null,
        revenueCurrency: null,
        roi: null,
      })),
    };
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
