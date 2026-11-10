import { describe, expect, it, jest } from '@jest/globals';
import { UserContextService } from './user-context.service';

function harness(overrides: Record<string, any> = {}) {
  const phaseService = {
    getPhaseMetrics: jest.fn(async () => ({
      phase: 'warm',
      score: 12,
      nextPhaseThreshold: 15,
      percentile: 42,
      everPaid: false,
      suggestedActions: [],
    })),
  };
  const trustScoreService = {
    getTrustContext: jest.fn(async () => ({ trustScore: 75, deviceRisk: 5 })),
  };
  const metricsService = {
    get7dMetrics: jest.fn(async () => ({
      views7d: 10,
      likes7d: 3,
      matches7d: 1,
      messages7d: 4,
      boostUsed7d: 0,
      retentionDays: 2,
    })),
    getUserIntelligenceMetrics: jest.fn(async () => ({
      messagesSent: 10,
      replies: 4,
      likes: 5,
      matches: 1,
      purchases: 1,
      paymentAttempts: 2,
      responseRate: 0.4,
      matchRate: 0.2,
      purchaseRate: 0.5,
    })),
  };
  const personalityService = {
    analyzePersonality: jest.fn(async () => ({
      ocean: {
        openness: 0.7,
        conscientiousness: null,
        extraversion: null,
        agreeableness: null,
        neuroticism: null,
      },
      oceanSource: 'self_authored_profile_and_messages',
      oceanStatus: 'text_estimate_uncalibrated',
      calibrated: false,
      matchingEligible: false,
      sentiment: null,
    })),
  };
  Object.assign(phaseService, overrides.phaseService ?? {});
  Object.assign(trustScoreService, overrides.trustScoreService ?? {});
  Object.assign(metricsService, overrides.metricsService ?? {});
  Object.assign(personalityService, overrides.personalityService ?? {});
  return {
    service: new UserContextService(
      phaseService as any,
      trustScoreService as any,
      metricsService as any,
      personalityService as any,
    ),
    phaseService,
    trustScoreService,
    metricsService,
    personalityService,
  };
}

describe('UserContextService AI grounding', () => {
  it('keeps failed sources unknown instead of inventing defaults', async () => {
    const h = harness({
      phaseService: { getPhaseMetrics: jest.fn(async () => { throw new Error('phase offline'); }) },
      trustScoreService: { getTrustContext: jest.fn(async () => { throw new Error('trust offline'); }) },
      metricsService: {
        get7dMetrics: jest.fn(async () => { throw new Error('metrics offline'); }),
        getUserIntelligenceMetrics: jest.fn(async () => { throw new Error('intelligence metrics offline'); }),
      },
      personalityService: { analyzePersonality: jest.fn(async () => { throw new Error('personality offline'); }) },
    });

    const context = await h.service.build(7);
    expect(context.phase).toBeNull();
    expect(context.trustScore).toBeNull();
    expect(context.metrics.views7d).toBeNull();
    expect(context.observedRates.response).toBeNull();
    expect(context.observedRates.match).toBeNull();
    expect(context.observedRates.purchase).toBeNull();
    expect(context.rateSamples.responseMessagesSent).toBeNull();
    expect(context.personality).toBeNull();

    const prompt = h.service.toPromptString(context);
    expect(prompt).toContain('اطلاعات تأییدشده کافی');
    expect(prompt).not.toContain('احتمال پاسخ');
    expect(prompt).not.toContain('نرخ پاسخ تاریخی');
    expect(prompt).not.toContain('0.2');
    expect(prompt).not.toContain('0.5');
  });

  it('does not expose legacy unverified personality values to the AI context', async () => {
    const h = harness({
      personalityService: {
        analyzePersonality: jest.fn(async () => ({
          ocean: { extraversion: 0.1 },
          oceanSource: 'legacy_unknown',
          oceanStatus: 'legacy_unverified',
          calibrated: false,
          matchingEligible: false,
        })),
      },
    });

    const context = await h.service.build(7);
    expect(context.personality).toBeNull();
    expect(h.service.toPromptString(context)).not.toContain('برآورد OCEAN');
  });

  it('preserves only evidence-backed axes from a consented, explicitly uncalibrated estimate', async () => {
    const h = harness();
    const context = await h.service.build(7);

    expect(context.personality?.openness).toBe(0.7);
    expect(context.personality?.extraversion).toBeNull();
    expect(context.personality?.source).toBe('self_authored_profile_and_messages');
    expect(context.personality?.calibrated).toBe(false);

    const prompt = h.service.toPromptString(context);
    expect(prompt).toContain('کالیبره‌نشده');
    expect(prompt).toContain('گشودگی=0.70');
    expect(prompt).not.toContain('برون‌گرایی=0.50');
  });

  it('labels historical ratios as observed rates and includes their actual denominators', async () => {
    const h = harness();
    const context = await h.service.build(7);

    expect(context.observedRates.response).toBe(0.4);
    expect(context.rateSamples.responseMessagesSent).toBe(10);
    expect(context.observedRates.match).toBe(0.2);
    expect(context.rateSamples.matchLikes).toBe(5);
    expect(context.observedRates.purchase).toBe(0.5);
    expect(context.rateSamples.purchaseAttempts).toBe(2);

    const prompt = h.service.toPromptString(context);
    expect(prompt).toContain('نرخ پاسخ تاریخی: 40% از 10 پیام ارسالی');
    expect(prompt).toContain('این نسبت گذشته است، نه پیش‌بینی پاسخ آینده');
    expect(prompt).toContain('نرخ تبدیل Like به Match تاریخی: 20% از 5 لایک');
    expect(prompt).toContain('نرخ موفقیت خرید تاریخی: 50% از 2 تلاش پرداخت');
    expect(prompt).not.toContain('احتمال پاسخ');
  });

  it('does not convert empty denominators into observed zero-percent rates', async () => {
    const h = harness({
      metricsService: {
        getUserIntelligenceMetrics: jest.fn(async () => ({
          messagesSent: 0,
          replies: 0,
          likes: 0,
          matches: 0,
          purchases: 0,
          paymentAttempts: 0,
          responseRate: 0,
          matchRate: 0,
          purchaseRate: 0,
        })),
      },
    });
    const context = await h.service.build(7);

    expect(context.observedRates.response).toBeNull();
    expect(context.observedRates.match).toBeNull();
    expect(context.observedRates.purchase).toBeNull();
    expect(h.service.toPromptString(context)).not.toContain('نرخ پاسخ تاریخی');
    expect(h.service.toPromptString(context)).not.toContain('نرخ موفقیت خرید');
  });
});
