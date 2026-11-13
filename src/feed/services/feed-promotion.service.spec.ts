import { describe, expect, it } from '@jest/globals';
import { FeedPromotionService } from './feed-promotion.service';

describe('FeedPromotionService truthful copy', () => {
  const service = new FeedPromotionService({} as any, {} as any);

  it('does not promise unsupported uplift, free, unlimited or fixed-discount benefits', () => {
    const personalize = (service as any).personalizePromotionContent.bind(service);
    const phases = [
      { phase: 'cold', isCompleted: false, everPaid: false },
      { phase: 'warm', isCompleted: true, everPaid: false },
      { phase: 'hot', isCompleted: true, everPaid: true },
    ];
    const copy: string[] = [];
    for (const phase of phases) {
      for (const variant of ['profile', 'boost', 'vip', 'credit', 'bundle']) {
        const result = personalize(variant, phase);
        copy.push(result.title, result.subtitle);
      }
    }
    expect(copy.join(' ')).not.toMatch(/برابر|\d+\s?٪|رایگان|نامحدود|همیشگی/);
  });
});
