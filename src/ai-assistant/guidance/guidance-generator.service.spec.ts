import { describe, expect, it } from '@jest/globals';
import { GuidanceGeneratorService } from './guidance-generator.service';

describe('GuidanceGeneratorService safeguards', () => {
  const service = new GuidanceGeneratorService({} as any, {} as any, {} as any, {} as any);

  it('routes to payment without inventing a fixed discount', () => {
    const guidance = (service as any).problemToGuidance(42, {
      category: 'payment',
      severity: 'medium',
      description: 'آخرین خرید مدتی قبل بوده است',
      reason: 'داده تخفیف فعال در دسترس نیست',
      solution: 'شرایط فعلی را بررسی کن',
      impact: 'تخفیف معتبر باید از کاتالوگ فعال دریافت شود',
    }, { phase: 'hot' });
    expect(guidance.action).toEqual({
      type: 'navigate',
      target: 'Payment',
      data: { product: 'credits' },
    });
    expect(JSON.stringify(guidance)).not.toContain('discount');
  });

  it('returns unknown rather than a fabricated guidance completion rate', async () => {
    await expect(service.getCompletionRate(42)).resolves.toBeNull();
  });
});
