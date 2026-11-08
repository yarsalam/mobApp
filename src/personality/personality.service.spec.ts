import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { PersonalityService } from './personality.service';

const createService = () => {
  const userRepo = {
    findOne: jest.fn<(...args: any[]) => Promise<any>>(),
    find: jest.fn<(...args: any[]) => Promise<any[]>>(),
    save: jest.fn<(user: any) => Promise<any>>(async (user: any) => user),
  };
  const messageQuery: any = {
    where: jest.fn(() => messageQuery),
    andWhere: jest.fn(() => messageQuery),
    orderBy: jest.fn(() => messageQuery),
    take: jest.fn(() => messageQuery),
    getMany: jest.fn(async () => []),
  };
  const messageRepo = {
    createQueryBuilder: jest.fn(() => messageQuery),
  };
  const llm = { ask: jest.fn<(...args: any[]) => Promise<string>>() };
  const service = new PersonalityService(
    {} as any,
    userRepo as any,
    messageRepo as any,
    {} as any,
    {} as any,
    {} as any,
    llm as any,
  );
  return { service, userRepo, messageRepo, messageQuery, llm };
};

describe('PersonalityService text consent and OCEAN safeguards', () => {
  it('only grants matching eligibility to validated questionnaire assessments with consent', async () => {
    const { service, userRepo } = createService();
    userRepo.find.mockResolvedValue([
      {
        id: 1,
        metadata: {
          personalityAssessment: {
            source: 'validated_questionnaire',
            status: 'validated',
            consentForMatching: true,
          },
        },
      },
      {
        id: 2,
        metadata: {
          personalityAssessment: {
            source: 'text_estimate',
            status: 'validated',
            consentForMatching: true,
          },
        },
      },
      {
        id: 3,
        metadata: {
          personalityAssessment: {
            source: 'validated_questionnaire',
            status: 'validated',
            consentForMatching: false,
          },
        },
      },
    ]);

    const result = await service.getBatchMatchingEligibility([1, 2, 3, 4]);

    expect(result.get(1)).toBe(true);
    expect(result.get(2)).toBe(false);
    expect(result.get(3)).toBe(false);
    expect(result.has(4)).toBe(false);
  });

  it('revokes consent and deletes the persisted text estimate without deleting unrelated metadata', async () => {
    const { service, userRepo } = createService();
    const user = {
      id: 9,
      metadata: {
        onboardingComplete: true,
        personalityTextAnalysis: { latestAssessment: { status: 'text_estimate_uncalibrated' } },
        personalityTextAnalysisConsent: {
          enabled: true,
          policyVersion: 'ocean-text-v1',
          grantedAt: '2026-11-01T00:00:00.000Z',
        },
      },
    };
    userRepo.findOne.mockResolvedValue(user);

    const result = await service.setTextAnalysisConsent(9, false);

    expect(result.enabled).toBe(false);
    expect(result.revokedAt).toBeTruthy();
    expect(user.metadata.onboardingComplete).toBe(true);
    expect(user.metadata.personalityTextAnalysis).toBeUndefined();
    expect(user.metadata.personalityTextAnalysisConsent.enabled).toBe(false);
    expect(userRepo.save).toHaveBeenCalledWith(user);
  });

  it('does not call the language model when explicit consent is absent', async () => {
    const { service, userRepo, messageRepo, llm } = createService();
    userRepo.findOne.mockResolvedValue({
      id: 10,
      aboutme: 'متن معرفی کاربر',
      metadata: {
        personalityTextAnalysisConsent: {
          enabled: false,
          policyVersion: 'ocean-text-v1',
        },
      },
    });

    await expect(service.analyzeTextPersonality(10)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(messageRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(llm.ask).not.toHaveBeenCalled();
  });

  it('returns the stored text estimate only while explicit consent remains enabled', async () => {
    const { service, userRepo } = createService();
    const assessment = {
      status: 'text_estimate_uncalibrated',
      matchingEligible: false,
      scores: { openness: { score: 0.6, confidence: 0.3, evidence: ['شاهد واقعی'] } },
    };

    userRepo.findOne.mockResolvedValueOnce({
      id: 12,
      metadata: {
        personalityTextAnalysisConsent: { enabled: true },
        personalityTextAnalysis: { latestAssessment: assessment },
      },
    });
    await expect(service.getTextPersonalityEstimate(12)).resolves.toEqual({
      enabled: true,
      assessment,
    });

    userRepo.findOne.mockResolvedValueOnce({
      id: 12,
      metadata: {
        personalityTextAnalysisConsent: { enabled: false },
        personalityTextAnalysis: { latestAssessment: assessment },
      },
    });
    await expect(service.getTextPersonalityEstimate(12)).resolves.toEqual({
      enabled: false,
      assessment: null,
    });
  });

  it('rejects invented evidence quotes and never marks a text estimate matching-eligible', async () => {
    const { service, userRepo, llm } = createService();
    const quote = 'این یک شاهد واقعی برای آزمایش است';
    const user = {
      id: 11,
      aboutme: `${quote} ${'متن معرفی تکمیلی برای رسیدن به حداقل طول لازم. '.repeat(7)}`,
      hobbies_self: [],
      values_self: [],
      metadata: {
        personalityTextAnalysisConsent: {
          enabled: true,
          policyVersion: 'ocean-text-v1',
        },
      },
    };
    userRepo.findOne.mockResolvedValue(user);
    llm.ask.mockResolvedValue(
      JSON.stringify({
        scores: {
          openness: { score: 0.8, confidence: 0.9, evidence: [quote] },
          conscientiousness: {
            score: 0.7,
            confidence: 0.9,
            evidence: ['این نقل قول ساختگی است و در ورودی وجود ندارد'],
          },
        },
        limitations: [],
      }),
    );

    const result = await service.analyzeTextPersonality(11);

    expect(result.matchingEligible).toBe(false);
    expect(result.calibrated).toBe(false);
    expect((result.scores as Record<string, any>).openness).not.toBeNull();
    expect((result.scores as Record<string, any>).openness.confidence).toBeLessThanOrEqual(0.5);
    expect((result.scores as Record<string, any>).conscientiousness).toBeNull();
  });
});
