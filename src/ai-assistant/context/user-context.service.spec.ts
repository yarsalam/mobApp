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
  const featureStore = {
    getUserFeatures: jest.fn(async () => ({
      responseProbability: 0.4,
      matchProbability: 0.3,
      purchaseProbability: null,
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
  Object.assign(featureStore, overrides.featureStore ?? {});
  Object.assign(trustScoreService, overrides.trustScoreService ?? {});
  Object.assign(metricsService, overrides.metricsService ?? {});
  Object.assign(personalityService, overrides.personalityService ?? {});
  return {
    service: new UserContextService(
      phaseService as any,
      featureStore as any,
      trustScoreService as any,
      metricsService as any,
      personalityService as any,
    ),
    phaseService,
    featureStore,
    trustScoreService,
    metricsService,
    personalityService,
  };
}

describe('UserContextService AI grounding', () => {
  it('keeps failed or unavailable sources unknown instead of inventing defaults', async () => {
    const h = harness({
      phaseService: { getPhaseMetrics: jest.fn(async () => { throw new Error('phase offline'); }) },
      featureStore: { getUserFeatures: jest.fn(async () => { throw new Error('feature store offline'); }) },
      trustScoreService: { getTrustContext: jest.fn(async () => { throw new Error('trust offline'); }) },
      metricsService: { get7dMetrics: jest.fn(async () => { throw new Error('metrics offline'); }) },
      personalityService: { analyzePersonality: jest.fn(async () => { throw new Error('personality offline'); }) },
    });

    const context = await h.service.build(7);
    expect(context.phase).toBeNull();
    expect(context.trustScore).toBeNull();
    expect(context.metrics.views7d).toBeNull();
    expect(context.probabilities.response).toBeNull();
    expect(context.probabilities.match).toBeNull();
    expect(context.probabilities.purchase).toBeNull();
    expect(context.personality).toBeNull();

    const prompt = h.service.toPromptString(context);
    expect(prompt).toContain('اطلاعات تأییدشده کافی');
    expect(prompt).not.toContain('احتمال پاسخ');
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

  it('passes through observed feature probabilities without replacing missing values', async () => {
    const h = harness();
    const context = await h.service.build(7);

    expect(context.probabilities.response).toBe(0.4);
    expect(context.probabilities.match).toBe(0.3);
    expect(context.probabilities.purchase).toBeNull();
    expect(h.service.toPromptString(context)).not.toContain('احتمال خرید');
  });
});
