import { Injectable } from '@nestjs/common';

@Injectable()
export class ActivityScoreCalculator {
  calculateViewsScore(metrics: any, weights: any): number {
    return (metrics.views7d || 0) * (weights.views || 0);
  }

  calculateRetentionScore(metrics: any, weights: any): number {
    return (metrics.retentionDays || 0) * (weights.retentionDays || 0);
  }

  calculateCityUsersScore(metrics: any, weights: any): number {
    return (metrics.cityUsers || 0) > 100 ? weights.cityUsers || 0 : 0;
  }
}
