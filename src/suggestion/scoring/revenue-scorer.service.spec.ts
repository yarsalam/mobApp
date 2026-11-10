import { describe, expect, it, jest } from '@jest/globals';
import { RevenueScorerService } from './revenue-scorer.service';

describe('RevenueScorerService — revenue separation', () => {
  it('does not let LTV or purchase propensity change candidate match ranking', async () => {
    const common = {
      profileVector: [1, 0, 0],
      preferenceVector: [1, 0, 0],
      behaviorVector: [1, 0],
      personalityVector: [0, 0, 0, 0, 0],
      geoVector: [0, 0],
      responseProbability: 0.8,
      matchProbability: 0.7,
      purchaseProbability: 0.1,
      phase: 'cold',
      trustScore: 80,
    };
    const features = new Map<number, any>([
      [1, { ...common, avgLTV: 0 }],
      [2, { ...common, avgLTV: 0 }],
      [3, { ...common, avgLTV: 10_000_000 }],
    ]);

    const featureStore: any = {
      getBatchFeatures: jest.fn(async () => features),
    };
    const redis: any = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
    };
    const service = new RevenueScorerService(featureStore, redis);

    const scores = await service.scoreBatch(1, [2, 3]);
    const withoutLtv = scores.find((score) => score.candidateId === 2)!;
    const withLtv = scores.find((score) => score.candidateId === 3)!;

    expect(withLtv.compatibilityScore).toBe(withoutLtv.compatibilityScore);
    expect(withLtv.decisionScore).toBe(withoutLtv.decisionScore);
    expect(withLtv.expectedRevenue).toBeGreaterThan(withoutLtv.expectedRevenue);
    expect(withLtv.components.businessSignal).toBeGreaterThan(
      withoutLtv.components.businessSignal,
    );
  });
});
