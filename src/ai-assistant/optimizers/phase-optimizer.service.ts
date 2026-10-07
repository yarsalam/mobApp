import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PhaseService } from '../../phase/phase.service';
import { ProblemDetectorService } from '../analyzers/problem-detector.service';
import { GuidanceGeneratorService } from '../guidance/guidance-generator.service';
import { UserEventService } from '../../user-event/user-event.service';
import { EventType } from 'src/user-event/type/event-type.enum';

export interface PhaseOptimizationPlan {
  userId: number;
  currentPhase: string;
  targetPhase: string;
  steps: {
    order: number;
    action: string;
    guidanceId: string;
    expectedImpact: string;
  }[];
  estimatedTimeToNextPhase: string;
}

@Injectable()
export class PhaseOptimizerService {
  private readonly logger = new Logger(PhaseOptimizerService.name);

  constructor(
    private readonly phaseService: PhaseService,
    private readonly problemDetector: ProblemDetectorService,
    private readonly guidanceGenerator: GuidanceGeneratorService,
    private readonly userEventService: UserEventService,
    @InjectQueue('phase-check') private readonly phaseCheckQueue: Queue,
  ) {}

  async createOptimizationPlan(userId: number): Promise<PhaseOptimizationPlan> {
    const phase = await this.phaseService.getPhaseMetrics(userId);
    const problems = await this.problemDetector.detectProblems(userId);
    const guidances = await this.guidanceGenerator.generateGuidance(userId);

    const targetPhase =
      phase.phase === 'cold' ? 'warm' : phase.phase === 'warm' ? 'hot' : 'hot';

    const steps = guidances
      .filter((g) => g.priority === 'high' || g.priority === 'medium')
      .map((g, index) => ({
        order: index + 1,
        action: g.message,
        guidanceId: g.id,
        expectedImpact:
          problems.find((p) => p.category === g.category)?.impact ??
          'بهبود عملکرد',
      }));

    // ← Fix: division by zero
    const progress =
      (phase.nextPhaseThreshold ?? 0) > 0
        ? (phase.score / phase.nextPhaseThreshold) * 100
        : 100;

    const plan: PhaseOptimizationPlan = {
      userId,
      currentPhase: phase.phase,
      targetPhase,
      steps,
      estimatedTimeToNextPhase: this.estimateTime(phase.phase, progress),
    };

    await this.userEventService.log({
      userId,
      type: EventType.PHASE_OPTIMIZATION_PLAN,
      metadata: {
        currentPhase: phase.phase,
        targetPhase,
        stepsCount: steps.length,
      },
    });

    return plan;
  }

  private estimateTime(currentPhase: string, progress: number): string {
    if (currentPhase === 'cold') {
      if (progress < 30) return '۵-۷ روز';
      if (progress < 70) return '۳-۵ روز';
      return '۱-۲ روز';
    }
    if (currentPhase === 'warm') {
      if (progress < 30) return '۷-۱۰ روز';
      if (progress < 70) return '۴-۷ روز';
      return '۲-۳ روز';
    }
    return 'شما در بالاترین فاز هستید';
  }

  async trackProgress(userId: number): Promise<void> {
    const oldPhase = await this.phaseService.getPhaseMetrics(userId);
    await this.phaseCheckQueue.add(
      'check-phase-upgrade',
      { userId, fromPhase: oldPhase.phase },
      { delay: 7 * 24 * 60 * 60 * 1000 },
    );
  }

  async createOptimizationPlanWithData(
    userId: number,
    problems: any[],
    phase: any,
  ): Promise<PhaseOptimizationPlan> {
    const targetPhase =
      phase.phase === 'cold' ? 'warm' : phase.phase === 'warm' ? 'hot' : 'hot';

    const guidances = problems
      .filter((p) => p.severity === 'high' || p.severity === 'medium')
      .map((problem, index) => ({
        order: index + 1,
        action: this.createActionMessage(problem),
        guidanceId: `guidance-${userId}-${index}`,
        expectedImpact: problem.impact ?? 'بهبود عملکرد',
      }));

    const progress =
      (phase.nextPhaseThreshold ?? 0) > 0
        ? (phase.score / phase.nextPhaseThreshold) * 100
        : 100;

    const plan: PhaseOptimizationPlan = {
      userId,
      currentPhase: phase.phase,
      targetPhase,
      steps: guidances,
      estimatedTimeToNextPhase: this.estimateTime(phase.phase, progress),
    };

    await this.userEventService.log({
      userId,
      type: EventType.PHASE_OPTIMIZATION_PLAN,
      metadata: {
        currentPhase: phase.phase,
        targetPhase,
        stepsCount: guidances.length,
      },
    });

    return plan;
  }

  private createActionMessage(problem: any): string {
    if (problem.category === 'profile') {
      if (problem.description.includes('ناقص'))
        return '🚀 پروفایلت رو تکمیل کن';
      if (problem.description.includes('شهر')) return '📍 شهرت رو اضافه کن';
      if (problem.description.includes('کوتاه'))
        return '📝 درباره‌ات رو بیشتر بنویس';
    }
    if (problem.category === 'image') {
      if (problem.description.includes('هیچ عکسی'))
        return '📸 حداقل یه عکس بذار';
      if (problem.description.includes('کم است'))
        return '🖼️ تعداد عکس‌هات رو بیشتر کن';
      if (problem.description.includes('کیفیت'))
        return '🔍 عکس‌های واضح‌تر بذار';
    }
    if (problem.category === 'engagement') {
      if (problem.description.includes('لایک کافی'))
        return '❤️ روزانه ۵ نفر رو لایک کن';
      if (problem.description.includes('هیچ پیامی'))
        return '💬 با ۳ نفر گفتگو رو شروع کن';
      if (problem.description.includes('نرخ تبدیل'))
        return '📊 عکس اصلی رو عوض کن';
    }
    return problem.description;
  }

  async getPhaseMetrics(userId: number) {
    return this.phaseService.getPhaseMetrics(userId);
  }
}
