import { describe, expect, it, jest } from '@jest/globals';
import { ProblemDetectorService } from './problem-detector.service';

const completePhase = {
  isCompleted: true,
  city: 'Tehran',
  bio: 'درباره علایق و ارزش‌های واقعی کاربر که برای شناخت اولیه ثبت شده است.',
  phase: 'warm',
  everPaid: false,
  suggestedActions: [],
};

function makeService(overrides: Record<string, any> = {}) {
  return new ProblemDetectorService(
    { getPhaseMetrics: jest.fn(async () => completePhase), ...overrides.phase },
    { findByUser: jest.fn(async () => []), ...overrides.images },
    { getUserInteractions: jest.fn(async () => []), ...overrides.interactions },
    { buildExtraMetrics: jest.fn(async () => ({ daysSinceSignup: 2, lastPurchaseDays: 0 })), ...overrides.metrics },
  );
}

describe('ProblemDetectorService evidence handling', () => {
  it('does not infer an incomplete profile when phase data is unavailable', async () => {
    const service = makeService({ phase: { getPhaseMetrics: jest.fn(async () => { throw new Error('offline'); }) } });
    const problems = await service.detectProblems(42);
    expect(problems.some((p) => p.category === 'profile' || p.category === 'phase')).toBe(false);
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

  it('does not output unsupported numeric profile/engagement uplift promises', async () => {
    const service = makeService({
      phase: { getPhaseMetrics: jest.fn(async () => ({ ...completePhase, isCompleted: false, city: null, bio: '' })) },
      images: { findByUser: jest.fn(async () => []) },
    });
    const problems = await service.detectProblems(42);
    const content = problems.map((p) => [p.reason, p.solution, p.impact].join(' ')).join(' ');
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
      phase: { getPhaseMetrics: jest.fn(async () => ({ ...completePhase, phase: 'warm', everPaid: false })) },
    });
    const problems = await service.detectProblems(42);
    expect(problems.some((p) => p.category === 'payment')).toBe(false);
  });

  it('detects old purchase only from a real last-purchase metric and never invents discount', async () => {
    const service = makeService({
      phase: { getPhaseMetrics: jest.fn(async () => ({ ...completePhase, phase: 'hot', everPaid: true })) },
      metrics: { buildExtraMetrics: jest.fn(async () => ({ daysSinceSignup: 100, lastPurchaseDays: 45 })) },
    });
    const problems = await service.detectProblems(42);
    const payment = problems.find((p) => p.category === 'payment');
    expect(payment?.description).toContain('۳۰ روز');
    expect(JSON.stringify(payment)).not.toMatch(/۲۰٪|۵۰٪|discount/i);
  });
});
