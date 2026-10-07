import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { AiFeedback } from '../entities/ai-feedback.entity';
import { Payment } from '../../payments/entities/payment.entity';

export interface ConversionInsights {
  conversionRate: number;
  avgTimeToConversion: number;
  topPerformingFeatures: Array<{
    feature: string;
    conversionRate: number;
    avgRevenue: number;
  }>;
  conversionFunnel: {
    step1: string;
    step2: string;
    step3: string;
    dropoffPoints: string[];
  };
  recommendations: Array<{
    type: string;
    message: string;
    expectedImpact: number;
  }>;
}

@Injectable()
export class ConversionAnalyticsService {
  private readonly logger = new Logger(ConversionAnalyticsService.name);

  constructor(
    @InjectRepository(AiFeedback)
    private readonly feedbackRepo: Repository<AiFeedback>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
  ) {}

  async analyzeConversion(userId?: number): Promise<ConversionInsights> {
    if (userId) {
      return this.analyzeUserConversion(userId);
    }
    return this.analyzeOverallConversion();
  }

  private async analyzeOverallConversion(): Promise<ConversionInsights> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [feedbacks, purchases] = await Promise.all([
      this.feedbackRepo.find({ where: { createdAt: MoreThan(thirtyDaysAgo) } }),
      this.paymentRepo.find({
        where: { createdAt: MoreThan(thirtyDaysAgo), status: 'paid' },
      }),
    ]);

    const usersWithFeedback = new Set(feedbacks.map((f) => f.userId));
    const usersWithPurchase = new Set(purchases.map((p) => p.userId));

    const convertingUsers = [...usersWithFeedback].filter((id) =>
      usersWithPurchase.has(id),
    );

    const conversionRate =
      convertingUsers.length / (usersWithFeedback.size || 1);

    const featureStats: Record<
      string,
      { count: number; conversions: number; revenue: number }
    > = {};

    for (const feedback of feedbacks) {
      if (!featureStats[feedback.feature]) {
        featureStats[feedback.feature] = {
          count: 0,
          conversions: 0,
          revenue: 0,
        };
      }
      featureStats[feedback.feature].count++;

      if (usersWithPurchase.has(feedback.userId)) {
        featureStats[feedback.feature].conversions++;
        const userPurchases = purchases.filter(
          (p) => p.userId === feedback.userId,
        );
        const totalRevenue = userPurchases.reduce(
          (sum, p) => sum + p.amount,
          0,
        );
        featureStats[feedback.feature].revenue += totalRevenue;
      }
    }

    const topPerformingFeatures = Object.entries(featureStats)
      .map(([feature, stats]) => ({
        feature,
        conversionRate: stats.conversions / (stats.count || 1),
        avgRevenue: stats.revenue / (stats.conversions || 1),
      }))
      .sort((a, b) => b.conversionRate - a.conversionRate)
      .slice(0, 5);

    return {
      conversionRate,
      avgTimeToConversion: await this.calculateAvgTimeToConversion(),
      topPerformingFeatures,
      conversionFunnel: await this.analyzeConversionFunnel(),
      recommendations: this.generateConversionRecommendations(
        conversionRate,
        topPerformingFeatures,
      ),
    };
  }

  private async calculateAvgTimeToConversion(): Promise<number> {
    // FIX: کوئری برای MySQL بازنویسی شد.
    //   EXTRACT(EPOCH FROM (a - b)) → TIMESTAMPDIFF(SECOND, b, a)
    //   created_at + INTERVAL '7 days' → DATE_ADD(created_at, INTERVAL 7 DAY)
    const result = await this.feedbackRepo.query(`
      SELECT AVG(TIMESTAMPDIFF(SECOND, f.created_at, p.created_at)) as avg_time
      FROM ai_feedback f
      JOIN payments p ON p.user_id = f.user_id
      WHERE p.created_at > f.created_at
        AND p.created_at < DATE_ADD(f.created_at, INTERVAL 7 DAY)
    `);
    return result[0]?.avg_time || 0;
  }

  private async analyzeConversionFunnel(): Promise<any> {
    return {
      step1: 'مشاهده پیشنهاد',
      step2: 'کلیک روی پیشنهاد',
      step3: 'تکمیل خرید',
      dropoffPoints: ['کلیک نکردن', 'انصراف در صفحه پرداخت'],
    };
  }

  private generateConversionRecommendations(
    conversionRate: number,
    topFeatures: any[],
  ): Array<{ type: string; message: string; expectedImpact: number }> {
    const recommendations: ConversionInsights['recommendations'] = [];

    if (conversionRate < 0.05) {
      recommendations.push({
        type: 'URGENT',
        message: 'نرخ تبدیل پایین است. پیشنهادات خرید را شخصی‌سازی کنید.',
        expectedImpact: 0.15,
      });
    }

    if (topFeatures[0]) {
      recommendations.push({
        type: 'OPPORTUNITY',
        message: `بهترین عملکرد: ${topFeatures[0].feature} با نرخ تبدیل ${(topFeatures[0].conversionRate * 100).toFixed(1)}%`,
        expectedImpact: 0.2,
      });
    }

    return recommendations;
  }

  private async analyzeUserConversion(
    userId: number,
  ): Promise<ConversionInsights> {
    const purchases = await this.paymentRepo.find({
      where: { userId, status: 'paid' },
    });

    return {
      conversionRate: purchases.length > 0 ? 1 : 0,
      avgTimeToConversion: 0,
      topPerformingFeatures: [],
      conversionFunnel: { step1: '', step2: '', step3: '', dropoffPoints: [] },
      recommendations: [],
    };
  }

  async getTopPerformingFeatures() {}
}
