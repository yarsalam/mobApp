import { ServiceUnavailableException } from '@nestjs/common';

interface AiAdviceProvider {
  getAdvice(userId: number): Promise<any>;
}

export async function loadSafetyUserAdvice(
  userId: number,
  aiAssistantService: AiAdviceProvider,
) {
  try {
    const advice = await aiAssistantService.getAdvice(userId);
    const tips: string[] = (advice?.topProblems ?? []).map(
      (problem: any) => `${problem.description} — ${problem.solution}`,
    );

    const phase = advice?.summary?.currentPhase ?? 'cold';
    const phaseLabel =
      phase === 'cold' ? 'سرد' : phase === 'warm' ? 'گرم' : 'داغ';
    const problemsCount = advice?.summary?.problemsCount ?? 0;
    const hasCritical = advice?.summary?.hasCriticalProblem ?? false;

    const personality_summary = [
      `فاز فعلی کاربر: ${phaseLabel}`,
      hasCritical
        ? '⚠️ مشکل بحرانی در پروفایل شناسایی شده'
        : problemsCount > 0
          ? `${problemsCount} مشکل شناسایی‌شده در پروفایل`
          : '✅ پروفایل بدون مشکل مهم',
      advice?.optimizationPlan?.estimatedTimeToNextPhase
        ? `زمان تخمینی به فاز بعدی: ${advice.optimizationPlan.estimatedTimeToNextPhase}`
        : '',
    ]
      .filter(Boolean)
      .join(' — ');

    return { tips, personality_summary };
  } catch {
    throw new ServiceUnavailableException(
      'AI advice is temporarily unavailable',
    );
  }
}
