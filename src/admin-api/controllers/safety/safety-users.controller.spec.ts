import { describe, expect, it, jest } from '@jest/globals';
import {
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SafetyUsersController } from './safety-users.controller';

describe('SafetyUsersController error contract', () => {
  it('returns a 404 when the requested user profile does not exist', async () => {
    const controller = Object.assign(
      Object.create(SafetyUsersController.prototype),
      { userRepo: { findOne: jest.fn().mockResolvedValue(null) } },
    ) as SafetyUsersController;

    await expect(controller.getProfile(404)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not turn AI advice service failures into empty advice', async () => {
    const controller = Object.assign(
      Object.create(SafetyUsersController.prototype),
      {
        aiAssistantService: {
          getAdvice: jest.fn().mockRejectedValue(new Error('AI unavailable')),
        },
      },
    ) as SafetyUsersController;

    await expect(controller.getAiAdvice(7)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('keeps successful AI advice in the existing response shape', async () => {
    const controller = Object.assign(
      Object.create(SafetyUsersController.prototype),
      {
        aiAssistantService: {
          getAdvice: jest.fn().mockResolvedValue({
            topProblems: [{ description: 'Incomplete profile', solution: 'Add details' }],
            summary: { currentPhase: 'warm', problemsCount: 1, hasCriticalProblem: false },
            optimizationPlan: { estimatedTimeToNextPhase: '2 days' },
          }),
        },
      },
    ) as SafetyUsersController;

    await expect(controller.getAiAdvice(7)).resolves.toEqual({
      tips: ['Incomplete profile — Add details'],
      personality_summary: 'فاز فعلی کاربر: گرم — 1 مشکل شناسایی‌شده در پروفایل — زمان تخمینی به فاز بعدی: 2 days',
    });
  });
});
