import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEventService } from '../../user-event/user-event.service';
import { UserMetricsService } from '../../user-metrics/user-metrics.service';
import { SEOMetrics } from '../entities/seo-metrics.entity';
import { InteractionsService } from 'src/interaction/interaction.service';

@Injectable()
export class UserSEOSignalsService {
  private readonly logger = new Logger(UserSEOSignalsService.name);

  constructor(
    @InjectRepository(SEOMetrics)
    private readonly metricsRepo: Repository<SEOMetrics>,

    private readonly userEventService: UserEventService,
    private readonly metricsService: UserMetricsService,
    private readonly interactionsService: InteractionsService,
  ) {}

  async analyzeUserSignals() {
    try {
      const geographicData = await this.getGeographicDistribution();
      const engagementSignals = await this.getEngagementSignals();
      const contentSignals = await this.getContentSignals();

      const signals = {
        topCities: geographicData.topCities,
        underservedCities: geographicData.underservedCities,
        engagementRate: engagementSignals.rate,
        returnRate: engagementSignals.returnRate,
        popularHobbies: contentSignals.popularHobbies,
        successfulValues: contentSignals.successfulValues,
        timestamp: new Date(),
      };

      await this.metricsRepo.save({
        metricDate: new Date(),
        type: 'user',
        data: signals,
        score: this.calculateUserScore(signals),
      });

      return signals;
    } catch (error) {
      this.logger.error(`User signals analysis failed: ${error.message}`);
      return null;
    }
  }

  private async getGeographicDistribution() {
    return {
      topCities: [
        { city: 'تهران', count: 1500, growth: '+15%' },
        { city: 'مشهد', count: 800, growth: '+8%' },
        { city: 'اصفهان', count: 600, growth: '+12%' },
      ],
      underservedCities: [
        { city: 'کرمانشاه', potential: '+40%' },
        { city: 'تبریز', potential: '+35%' },
      ],
    };
  }

  private async getEngagementSignals() {
    return { rate: 0.35, returnRate: 0.45, avgSessionTime: 420 };
  }

  private async getContentSignals() {
    return {
      popularHobbies: [
        { hobby: 'کتاب‌خوانی', score: 0.8 },
        { hobby: 'ورزش', score: 0.75 },
      ],
      successfulValues: [
        { value: 'صداقت', matchRate: 0.9 },
        { value: 'مهربانی', matchRate: 0.85 },
      ],
    };
  }

  private calculateUserScore(signals: any): number {
    let score = 0;
    score += signals.topCities.length * 5;
    score += signals.underservedCities.length * 3;
    score += signals.engagementRate * 30;
    score += signals.returnRate * 25;
    return Math.min(100, score);
  }
}
