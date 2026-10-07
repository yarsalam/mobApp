import { Injectable } from '@nestjs/common';

@Injectable()
export class RevenueScoreCalculator {
  calculatePastPaymentsScore(metrics: any, weights: any): number {
    return (
      Math.log2((metrics.pastPayments || 0) + 1) * (weights.pastPayments || 0)
    );
  }

  calculateBoostScore(metrics: any, weights: any): number {
    return (metrics.boostUsed7d || 0) * (weights.boostUsed || 0);
  }
}
