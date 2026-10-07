import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SEOMetrics } from '../../entities/seo-metrics.entity';
import { RevenueIntelligenceService } from '../../../revenue/revenue-intelligence.service';
import { SocialListenerService } from 'src/social-listener/social-listener.service';

@Injectable()
export class SEOMonitoringService {
  private readonly logger = new Logger(SEOMonitoringService.name);

  constructor(
    @InjectRepository(SEOMetrics)
    private readonly metricsRepo: Repository<SEOMetrics>,

    private readonly revenueService: RevenueIntelligenceService,
    private readonly socialListener: SocialListenerService,

    @InjectQueue('seo-analysis')
    private readonly seoQueue: Queue,
  ) {}

  @Cron('0 * * * *') // هر ساعت
  async checkModelDrift() {
    this.logger.debug('Checking for model drift...');

    const predictions = await this.getLastWeekPredictions();
    const actuals = await this.getLastWeekActuals();

    const mae = this.calculateMAE(predictions, actuals);
    const threshold = 0.2; // 20%

    if (mae > threshold) {
      this.logger.warn(`Model drift detected! MAE: ${mae}`);

      // ذخیره هشدار
      await this.metricsRepo.save({
        metricDate: new Date(),
        type: 'model_drift',
        data: { mae, threshold },
        score: 100 - mae * 100,
      });

      // Retrain model
      await this.seoQueue.add('retrain-models', {
        reason: 'drift_detected',
        mae,
        timestamp: new Date(),
      });
    }
  }

  @Cron('0 0 * * *') // هر روز
  async checkRevenueForecast() {
    this.logger.debug('Checking revenue forecast accuracy...');

    const forecast = await this.getCurrentForecast();
    const actual = await this.getYesterdaysRevenue();

    const error = Math.abs(forecast - actual) / actual;

    await this.metricsRepo.save({
      metricDate: new Date(),
      type: 'forecast_accuracy',
      data: { error, forecast, actual },
    });

    if (error > 0.3) {
      this.logger.warn(`Revenue forecast error high: ${error}`);
      // هشدار به ادمین
    }
  }

  private async getLastWeekPredictions(): Promise<number[]> {
    // TODO: از دیتابیس predictions
    return [100, 120, 110, 130, 125, 140, 135];
  }

  private async getLastWeekActuals(): Promise<number[]> {
    // TODO: از دیتابیس actuals
    return [95, 115, 112, 128, 130, 138, 140];
  }

  private calculateMAE(predictions: number[], actuals: number[]): number {
    if (predictions.length !== actuals.length) return 0;

    const sum = predictions.reduce((acc, pred, i) => {
      return acc + Math.abs(pred - actuals[i]);
    }, 0);

    return sum / predictions.length;
  }

  private async getCurrentForecast(): Promise<number> {
    // TODO: از RevenueIntelligence
    return 15000;
  }

  private async getYesterdaysRevenue(): Promise<number> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // TODO: از PaymentsService
    return 14500;
  }

  @Cron('0 * * * *') // هر ساعت
  async scanSocialMedia() {
    await this.socialListener.scanTelegramChannels();
  }
}
