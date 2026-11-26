import { describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { loadSafetyUserAdvice } from './safety-user-advice';

describe('loadSafetyUserAdvice', () => {
  it('preserves the existing successful response shape', async () => {
    const getAdvice = jest.fn<() => Promise<any>>().mockResolvedValue({
      topProblems: [{ description: 'Incomplete profile', solution: 'Add details' }],
      summary: { currentPhase: 'warm', problemsCount: 1, hasCriticalProblem: false },
      optimizationPlan: { estimatedTimeToNextPhase: '2 days' },
    });

    await expect(loadSafetyUserAdvice(7, { getAdvice })).resolves.toEqual({
      tips: ['Incomplete profile — Add details'],
      personality_summary: 'فاز فعلی کاربر: گرم — 1 مشکل شناسایی‌شده در پروفایل — زمان تخمینی به فاز بعدی: 2 days',
    });
    expect(getAdvice).toHaveBeenCalledWith(7);
  });

  it('returns an explicit service-unavailable error instead of empty advice', async () => {
    const getAdvice = jest
      .fn<() => Promise<any>>()
      .mockRejectedValue(new Error('AI unavailable'));

    await expect(loadSafetyUserAdvice(7, { getAdvice })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
