import { Injectable } from '@nestjs/common';

@Injectable()
export class EngagementScoreCalculator {
  calculateQualityMultiplier(metrics: any): {
    likeQuality: number;
    messageQuality: number;
  } {
    const likeQuality =
      metrics.matches7d > 0
        ? Math.min(metrics.matches7d / (metrics.likes7d || 1), 1)
        : 0.5;
    const messageQuality =
      metrics.messages7d > 0
        ? Math.min(metrics.receivedMessages7d / (metrics.messages7d || 1), 1)
        : 0.5;
    return { likeQuality, messageQuality };
  }

  calculateMatchesScore(metrics: any, weights: any): number {
    const effectiveMatches =
      (metrics.matches7d || 0) *
      this.calculateQualityMultiplier(metrics).likeQuality;
    return effectiveMatches * (weights.matches || 0);
  }

  calculateMessagesScore(metrics: any, weights: any): number {
    const effectiveMessages =
      (metrics.messages7d || 0) *
      this.calculateQualityMultiplier(metrics).messageQuality;
    return effectiveMessages * (weights.messages || 0);
  }
}
