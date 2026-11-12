import { Injectable } from '@nestjs/common';

export interface SeoScoreResult {
  status: 'not_scored';
  overall: null;
  breakdown: Record<string, never>;
  weights: Record<string, never>;
  effective: null;
  grade: 'not_scored';
  recommendations: [];
}

/**
 * Legacy SEO scoring is retired. Arbitrary weighted scores mixed with
 * fabricated user/competitor data must not be surfaced as product health.
 */
@Injectable()
export class SEOScoreEngine {
  calculateOverallScore(_metrics: unknown): SeoScoreResult {
    return {
      status: 'not_scored',
      overall: null,
      breakdown: {},
      weights: {},
      effective: null,
      grade: 'not_scored',
      recommendations: [],
    };
  }

  async generateNextAction(_score?: unknown): Promise<null> {
    return null;
  }
}
