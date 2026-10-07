import { Injectable, Logger } from '@nestjs/common';

interface ScalingRecommendation {
  type: string;
  priority: 'high' | 'medium' | 'low';
  action: string;
  reason: string;
  estimatedCost: number;
  estimatedImpact: string;
  roi: string;
}

@Injectable()
export class AutoScalingService {
  private readonly logger = new Logger(AutoScalingService.name);

  async recommendScaling(metrics: any) {
    const userCount = metrics.userCount || 0;
    const revenue = metrics.revenue || 0;
    const serverLoad = metrics.serverLoad || 0;
    const growthRate = metrics.growthRate || 0;

    const recommendations: ScalingRecommendation[] = [];

    // ۱. بر اساس تعداد کاربر
    if (userCount > 10000 && serverLoad > 70) {
      recommendations.push({
        type: 'server',
        priority: 'high',
        action: 'افزایش capacity سرور',
        reason: `${userCount.toLocaleString()} کاربر فعال - بار سرور ${serverLoad}%`,
        estimatedCost: 200,
        estimatedImpact: 'کاهش latency 40%',
        roi: 'ضروری',
      });
    } else if (userCount > 5000 && serverLoad > 60) {
      recommendations.push({
        type: 'server',
        priority: 'medium',
        action: 'بررسی نیاز به ارتقاء سرور',
        reason: `رشد سریع کاربران - بار فعلی ${serverLoad}%`,
        estimatedCost: 0,
        estimatedImpact: 'پیشگیری از کندی',
        roi: 'پیشگیرانه',
      });
    }

    // ۲. بر اساس درآمد
    if (revenue > 5000) {
      recommendations.push({
        type: 'marketing',
        priority: revenue > 10000 ? 'high' : 'medium',
        action: 'افزایش بودجه تبلیغات',
        reason: `درآمد فعلی $${revenue.toLocaleString()}/ماه`,
        estimatedCost: revenue * 0.3,
        estimatedImpact: 'افزایش ۵۰٪ ترافیک',
        roi: `${Math.round(((revenue * 0.3 * 2) / (revenue * 0.3)) * 100)}%`,
      });
    }

    // ۳. بر اساس رشد
    if (growthRate > 0.2) {
      recommendations.push({
        type: 'hiring',
        priority: 'high',
        action: 'استخدام متخصص سئو',
        reason: `رشد ${Math.round(growthRate * 100)}% ماهانه - نیاز به نیروی متخصص`,
        estimatedCost: 1000,
        estimatedImpact: 'افزایش ۳۰٪ سرعت اجرا',
        roi: 'بلندمدت',
      });
    }

    // ۴. بر اساس SEO metrics
    if (metrics.seoScore < 60) {
      recommendations.push({
        type: 'seo',
        priority: 'high',
        action: 'تولید محتوای هدفمند',
        reason: `نمره سئو: ${metrics.seoScore}`,
        estimatedCost: 0,
        estimatedImpact: '+۲۰٪ ترافیک ارگانیک',
        roi: '∞',
      });
    } else if (metrics.seoScore > 85) {
      recommendations.push({
        type: 'seo',
        priority: 'medium',
        action: 'توسعه به بازارهای جدید',
        reason: 'سئوی داخلی بهینه است - وقت گسترش',
        estimatedCost: 500,
        estimatedImpact: 'کاربران جدید از کشورهای همسایه',
        roi: '۲۰۰٪',
      });
    }

    return recommendations;
  }

  async calculateOptimalResources(metrics: any) {
    const userCount = metrics.userCount || 0;
    const revenue = metrics.revenue || 0;

    // فرمول ساده: هر ۱۰۰۰ کاربر = ۱ core CPU + ۲GB RAM
    const baseServers = Math.max(1, Math.ceil(userCount / 5000));

    // تیم مورد نیاز
    const team = {
      developers: Math.max(1, Math.ceil(userCount / 10000)),
      seoExperts: Math.max(0, Math.floor(userCount / 5000)),
      contentWriters: Math.max(0, Math.floor(userCount / 8000)),
      support: Math.max(1, Math.ceil(userCount / 20000)),
    };

    // بودجه پیشنهادی
    const budget = {
      servers: baseServers * 200,
      marketing: revenue * 0.3,
      team:
        team.developers * 3000 +
        team.seoExperts * 2000 +
        team.contentWriters * 1500 +
        team.support * 1000,
      total: 0,
    };
    budget.total = budget.servers + budget.marketing + budget.team;

    return {
      currentScale: {
        users: userCount,
        servers: baseServers,
        team,
        monthlyBudget: budget.total,
      },
      recommendations: await this.recommendScaling(metrics),
    };
  }
}
