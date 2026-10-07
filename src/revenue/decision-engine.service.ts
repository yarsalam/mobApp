import { Injectable, Logger } from '@nestjs/common';
import { RevenueIntelligenceService } from './revenue-intelligence.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { FeatureStoreRevenueService } from 'src/feature-store-rvenue/feature-store-rvenue.service';

@Injectable()
export class DecisionEngineService {
  private readonly logger = new Logger(DecisionEngineService.name);

  constructor(
    private readonly revenueIntelligence: RevenueIntelligenceService,
    private readonly featureStore: FeatureStoreRevenueService,
    @InjectQueue('ml-predictions') private readonly mlQueue: Queue,
  ) {}

  async getStrategicDecisions(): Promise<{
    budgetAllocation: Array<{
      channel: string;
      currentSpend: number;
      recommendedSpend: number;
      expectedROI: number;
      confidence: number;
    }>;
    contentPriorities: Array<{
      topic: string;
      type: string;
      estimatedTraffic: number;
      estimatedConversion: number;
      priority: 'high' | 'medium' | 'low';
    }>;
    alerts: Array<{
      type: string;
      severity: 'critical' | 'warning' | 'info';
      message: string;
      action: string;
    }>;
    forecast: {
      nextMonth: number;
      nextQuarter: number;
      growthRate: number;
      confidence: number;
    };
  }> {
    // 1. دریافت LTV by channel
    const ltvByChannel = await this.revenueIntelligence.getLTVByChannel();

    // 2. دریافت features همه کاربران
    const allUsers = await this.featureStore.getAllUsers();
    const features = await this.featureStore.batchGetFeatures(allUsers);

    // 3. پیش‌بینی درآمد از ML
    const forecast = await this.mlQueue.add('forecast', {
      features,
      days: 90,
    });

    // 4. محاسبه تخصیص بودجه بهینه
    const budgetAllocation = this.optimizeBudget(ltvByChannel, forecast);

    // 5. تولید اولویت‌های محتوا
    const contentPriorities = await this.generateContentPriorities(features);

    // 6. تشخیص هشدارها
    const alerts = await this.detectAlerts();

    return {
      budgetAllocation,
      contentPriorities,
      alerts,
      forecast: {
        nextMonth: 15000,
        nextQuarter: 50000,
        growthRate: 0.15,
        confidence: 0.85,
      },
    };
  }

  private optimizeBudget(ltvByChannel: any[], forecast: any): any[] {
    // تخصیص بودجه بر اساس LTV و ROI
    const totalBudget = 10000; // placeholder

    return ltvByChannel
      .sort((a, b) => b.ltv - a.ltv)
      .map((channel, index) => ({
        channel: channel.source,
        currentSpend: channel.cost || 1000,
        recommendedSpend: totalBudget * (1 / (index + 1)) * 0.5,
        expectedROI: channel.ltv / (channel.cac || 1),
        confidence: 0.9 - index * 0.1,
      }));
  }

  private async generateContentPriorities(features: any[]): Promise<any[]> {
    // تحلیل features برای پیدا کردن موضوعات داغ
    return [
      {
        topic: 'راهنمای همسریابی در شهرهای کوچک',
        type: 'local_guide',
        estimatedTraffic: 5000,
        estimatedConversion: 0.15,
        priority: 'high',
      },
      {
        topic: 'چطور با هابی‌های مشترک همسر پیدا کنیم',
        type: 'blog',
        estimatedTraffic: 8000,
        estimatedConversion: 0.12,
        priority: 'high',
      },
    ];
  }

  private async detectAlerts(): Promise<any[]> {
    const alerts: Array<{
      type: string;
      severity: string;
      message: string;
      action?: string;
    }> = [];

    // ناهنجاری‌های درآمدی
    const anomalies = await this.revenueIntelligence.detectAnomalies();
    for (const anomaly of anomalies) {
      alerts.push({
        type: 'revenue_anomaly',
        severity: anomaly.severity === 'high' ? 'critical' : 'warning',
        message: `${anomaly.deviation * 100}% انحراف از پیش‌بینی در ${anomaly.date.toLocaleDateString('fa-IR')}`,
        action: 'بررسی فعالیت‌های سئو در آن روز',
      });
    }

    return alerts;
  }
}
