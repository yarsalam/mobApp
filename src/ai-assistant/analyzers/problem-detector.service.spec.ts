import { describe, expect, it, jest } from '@jest/globals';
import { ProblemDetectorService } from './problem-detector.service';

const completeUser = {
  isCompleted: true,
  city: 'Tehran',
  aboutme: 'درباره علایق و ارزش‌های واقعی کاربر که برای شناخت اولیه ثبت شده است.',
};

function makeService(overrides: Record<string, any> = {}) {
  return new ProblemDetectorService(
    { getPhaseMetrics: jest.fn(async () => ({ phase: 'warm', everPaid: false })), ...overrides.phase },
    { findOne: jest.fn(async () => completeUser), ...overrides.user },
    { findByUser: jest.fn(async () => []), ...overrides.images },
    { getUserInteractions: jest.fn(async () => []), ...overrides.interactions },
    { buildExtraMetrics: jest.fn(async () => ({ daysSinceSignup: 2, lastPurchaseDays: null })), ...overrides.metrics },
  );
}

describe('ProblemDetectorService evidence handling', () => {
  it('does not infer an incomplete profile when the user record is unavailable', async () => {
    const service = makeService({ user: { findOne: jest.fn(async () => { throw new Error('offline'); }) } });
    const problems = await service.detectProblems(42);
    expect(problems.some((p) => p.category === 'profile')).toBe(false);
  });

  it('does not infer a phase when phase metrics are unavailable', async () => {
    const service = makeService({ phase: { getPhaseMetrics: jest.fn(async () => { throw new Error('offline'); }) } });
    const problems = await service.detectProblems(42);
    expect(problems.some((p) => p.category === 'phase' || p.category === 'payment')).toBe(false);
  });

  it('does not treat image-service failure as proof that the user has no photos', async () => {
    const service = makeService({ images: { findByUser: jest.fn(async () => { throw new Error('offline'); }) } });
    const problems = await service.detectProblems(42);
    expect(problems.some((p) => p.category === 'image')).toBe(false);
  });

  it('keeps missing image quality unknown instead of scoring it as zero', async () => {
    const service = makeService({ images: { findByUser: jest.fn(async () => [{ id: 1, url: 'image', qualityScore: null }]) } });
    const problems = await service.detectProblems(42);
    expect(problems.some((p) => p.description.includes('امتیاز داخلی کیفیت'))).toBe(false);
  });

  it('bases profile recommendations on persisted User fields without numeric uplift promises', async () => {
    const service = makeService({
      user: { findOne: jest.fn(async () => ({ isCompleted: false, city: null, aboutme: '' })) },
      images: { findByUser: jest.fn(async () => []) },
    });
    const problems = await service.detectProblems(42);
    const content = problems.map((p) => [p.reason, p.solution, p.impact].join(' ')).join(' ');
    expect(problems.some((p) => p.category === 'profile')).toBe(true);
    expect(content).not.toMatch(/۵ برابر|۱۰ برابر|۳ برابر|۵۰٪|۲۰٪/);
  });

  it('withholds engagement conclusions when interaction history is unavailable', async () => {
    const service = makeService({
      interactions: { getUserInteractions: jest.fn(async () => { throw new Error('offline'); }) },
      metrics: { buildExtraMetrics: jest.fn(async () => ({ daysSinceSignup: 20 })) },
    });
    const problems = await service.detectProblems(42);
    expect(problems.some((p) => p.category === 'engagement')).toBe(false);
  });

  it('does not show a purchase prompt to every non-paying warm user', async () => {
    const service = makeService({
      phase: { getPhaseMetrics: jest.fn(async () => ({ phase: 'warm', everPaid: false })) },
    });
    const problems = await service.detectProblems(42);
    expect(problems.some((p) => p.category === 'payment')).toBe(false);
  });

  it('detects old purchases only from real phase and successful-payment age data', async () => {
    const service = makeService({
      phase: { getPhaseMetrics: jest.fn(async () => ({ phase: 'hot', everPaid: true })) },
      metrics: { buildExtraMetrics: jest.fn(async () => ({ daysSinceSignup: 100, lastPurchaseDays: 45 })) },
    });
    const problems = await service.detectProblems(42);
    const payment = problems.find((p) => p.category === 'payment');
    expect(payment?.description).toContain('۳۰ روز');
    expect(JSON.stringify(payment)).not.toMatch(/۲۰٪|۵۰٪|discount/i);
  });
});
