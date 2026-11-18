import { describe, expect, it, jest } from '@jest/globals';
import { of, throwError } from 'rxjs';
import { PromotionEngineService } from './promotion-engine.service';

function makeEngine(options: {
  canShow?: (variant: string) => Promise<boolean>;
  prediction?: any;
  predictionError?: boolean;
  featureError?: boolean;
} = {}) {
  const featureService: any = {
    getUserFeatures: jest.fn(async () => {
      if (options.featureError) throw new Error('feature store unavailable');
      return {
        engagement_score: 0.95,
        dismiss_rate: 0.1,
        last_purchase_days: 60,
        boostActive: false,
        creditsBalance: 0,
      };
    }),
  };
  const exposureService: any = {
    canShow: jest.fn(async (userId: number, variant: string) =>
      options.canShow ? options.canShow(variant) : true,
    ),
  };
  const httpService: any = {
    post: jest.fn(() =>
      options.predictionError
        ? throwError(() => new Error('model unavailable'))
        : of({ data: options.prediction ?? { variant: 'credit', score: 0.8 } }),
    ),
  };
  const configService: any = { get: jest.fn(() => 'http://ai-monetization.test') };
  return {
    engine: new PromotionEngineService(featureService, exposureService, httpService, configService),
    featureService,
    exposureService,
    httpService,
  };
}

describe('PromotionEngineService fail-closed fallback', () => {
  it('uses only variants that passed the Redis exposure limits when ML is unavailable', async () => {
    const h = makeEngine({
      canShow: async (variant) => variant !== 'vip',
      predictionError: true,
    });
    const result = await h.engine.decide(42, ['vip', 'credit']);

    expect(result.variant).toBe('credit');
    expect(h.exposureService.canShow).toHaveBeenCalledTimes(2);
  });

  it('does not fall back around an exposure-limit or Redis failure', async () => {
    const h = makeEngine({
      canShow: async () => { throw new Error('redis down'); },
      predictionError: true,
    });
    const result = await h.engine.decide(42, ['vip', 'credit']);

    expect(result).toEqual({ variant: null, score: 0 });
    expect(h.httpService.post).not.toHaveBeenCalled();
  });

  it('returns no promotion when feature context cannot be loaded', async () => {
    const h = makeEngine({ featureError: true });
    const result = await h.engine.decide(42, ['vip']);

    expect(result).toEqual({ variant: null, score: 0 });
    expect(h.exposureService.canShow).not.toHaveBeenCalled();
  });

  it('rejects an ML response that names a variant outside the eligible candidate set', async () => {
    const h = makeEngine({
      canShow: async (variant) => variant === 'credit',
      prediction: { variant: 'vip', score: 0.99 },
    });
    const result = await h.engine.decide(42, ['credit', 'vip']);

    expect(result.variant).toBe('credit');
  });
});
