import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProblemDetectorService } from '../analyzers/problem-detector.service';
import { PhaseService } from '../../phase/phase.service';
import { UserEventService } from '../../user-event/user-event.service';
import { RedisService } from '../../redis/redis.service';
import { UserProblem } from '../types/user-problem.interface';
import { EventType } from 'src/user-event/type/event-type.enum';

export interface Guidance {
  id: string;
  userId: number;
  timestamp: Date;
  priority: 'high' | 'medium' | 'low';
  message: string;
  action: {
    type: 'navigate' | 'show_tip' | 'send_notification' | 'offer_discount';
    target?: string;
    data?: any;
  };
  category: string;
  expiresAt?: Date;
}

// TTL برای guidance history در Redis (۷ روز)
const GUIDANCE_HISTORY_TTL_SEC = 7 * 24 * 60 * 60;

@Injectable()
export class GuidanceGeneratorService {
  private readonly logger = new Logger(GuidanceGeneratorService.name);

  constructor(
    private readonly phaseService: PhaseService,
    private readonly problemDetector: ProblemDetectorService,
    private readonly userEventService: UserEventService,
    private readonly redis: RedisService,
  ) {}

  async generateGuidance(userId: number): Promise<Guidance[]> {
    const problems = await this.problemDetector.detectProblems(userId);
    const phase = await this.phaseService.getPhaseMetrics(userId);

    const guidanceList: Guidance[] = [];
    for (const problem of problems) {
      // در فاز cold مشکلات payment نمایش داده نمی‌شوند
      if (phase.phase === 'cold' && problem.category === 'payment') continue;
      guidanceList.push(this.problemToGuidance(userId, problem, phase));
    }

    const prioritized = this.prioritizeGuidance(guidanceList, phase);

    await this.userEventService.log({
      userId,
      type: EventType.GUIDANCE_GENERATED,
      metadata: { count: guidanceList.length, phase: phase.phase },
    });

    return prioritized;
  }

  async getNextGuidance(userId: number): Promise<Guidance | null> {
    const guidanceList = await this.generateGuidance(userId);
    const lastShown = await this.getLastShownGuidance(userId);

    const newGuidance = guidanceList.filter(
      (g) => !lastShown.includes(g.category) || g.priority === 'high',
    );
    if (newGuidance.length === 0) return null;

    const next = newGuidance[0];

    // ذخیره در Redis
    await this.markGuidanceAsShown(userId, next.category);

    await this.userEventService.log({
      userId,
      type: EventType.GUIDANCE_SHOWN,
      metadata: { category: next.category, priority: next.priority },
    });

    return next;
  }

  // ─── Redis helpers ────────────────────────────────────────────────────────

  private redisKey(userId: number): string {
    return `assistant:guidance:${userId}`;
  }

  /**
   * لیست category هایی که در ۷ روز گذشته نمایش داده شده‌اند.
   */
  private async getLastShownGuidance(userId: number): Promise<string[]> {
    try {
      const raw = await this.redis.get(this.redisKey(userId));
      if (!raw) return [];
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }

  /**
   * category جدید را به لیست نمایش‌داده‌شده‌ها اضافه می‌کند.
   * TTL = ۷ روز.
   */
  private async markGuidanceAsShown(
    userId: number,
    category: string,
  ): Promise<void> {
    try {
      const current = await this.getLastShownGuidance(userId);
      const updated = Array.from(new Set([...current, category]));
      await this.redis.set(
        this.redisKey(userId),
        JSON.stringify(updated),
        GUIDANCE_HISTORY_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to save guidance history for user ${userId}: ${err}`,
      );
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private problemToGuidance(
    userId: number,
    problem: UserProblem,
    phase: any,
  ): Guidance {
    const priorityMap: Record<
      UserProblem['severity'],
      'high' | 'medium' | 'low'
    > = {
      critical: 'high',
      high: 'high',
      medium: 'medium',
      low: 'low',
    };

    let action: Guidance['action'] = { type: 'show_tip' };
    switch (problem.category) {
      case 'profile':
      case 'image':
        action = {
          type: 'navigate',
          target: 'EditProfile',
          data: { focus: problem.category },
        };
        break;
      case 'payment':
        action = {
          type: 'offer_discount',
          data: {
            product: 'credits',
            discount: phase.phase === 'hot' ? 20 : 0,
          },
        };
        break;
      case 'engagement':
        action = {
          type: 'navigate',
          target: 'Feed',
          data: { showSuggestions: true },
        };
        break;
    }

    return {
      id: `guidance-${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId,
      timestamp: new Date(),
      priority: priorityMap[problem.severity],
      message: this.createMessage(problem),
      action,
      category: problem.category,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
  }

  private createMessage(problem: UserProblem): string {
    if (problem.category === 'profile') {
      if (problem.description.includes('ناقص'))
        return `🚀 پروفایلت ناقصه! با تکمیلش ${problem.impact}`;
      if (problem.description.includes('شهر'))
        return '📍 شهرت رو اضافه کن تا با همشهری‌ها آشنا شی';
      if (problem.description.includes('کوتاه'))
        return `📝 درباره‌ات رو بیشتر بنویس — ${problem.impact}`;
    }
    if (problem.category === 'image') {
      if (problem.description.includes('هیچ عکسی'))
        return '📸 عکس نداری! ۱۰ برابر کمتر دیده می‌شی';
      if (problem.description.includes('کم است'))
        return '🖼️ فقط ۲ عکس داری، حداقل ۳ تا بذار';
      if (problem.description.includes('کیفیت'))
        return '🔍 کیفیت عکس‌هات پایینه، عکس‌های واضح‌تر بذار';
    }
    if (problem.category === 'engagement') {
      if (problem.description.includes('لایک کافی'))
        return '❤️ روزانه ۵ نفر رو لایک کن';
      if (problem.description.includes('هیچ پیامی'))
        return '💬 هنوز پیامی نفرستادی! با ۳ نفر شروع کن';
      if (problem.description.includes('نرخ تبدیل'))
        return '📊 بازدید به لایک کمه، عکس اصلی رو عوض کن';
    }
    return problem.description;
  }

  private prioritizeGuidance(guidanceList: Guidance[], phase: any): Guidance[] {
    const order: Record<string, string[]> = {
      cold: ['profile', 'image', 'engagement', 'personality', 'payment'],
      warm: ['engagement', 'payment', 'profile', 'image', 'personality'],
      hot: ['payment', 'engagement', 'personality', 'profile', 'image'],
    };
    const phaseOrder = order[phase.phase] ?? order['cold'];

    return guidanceList.sort((a, b) => {
      if (a.priority !== b.priority) {
        const w = { high: 3, medium: 2, low: 1 };
        return w[b.priority] - w[a.priority];
      }
      return phaseOrder.indexOf(a.category) - phaseOrder.indexOf(b.category);
    });
  }

  async getNextGuidanceWithData(
    userId: number,
    problems: any[],
    phase: any,
  ): Promise<Guidance | null> {
    const guidanceList = problems.map((problem) =>
      this.problemToGuidance(userId, problem, phase),
    );

    const prioritized = this.prioritizeGuidance(guidanceList, phase);
    const lastShown = await this.getLastShownGuidance(userId);

    const newGuidance = prioritized.filter(
      (g) => !lastShown.includes(g.category) || g.priority === 'high',
    );
    if (newGuidance.length === 0) return null;

    const next = newGuidance[0];
    await this.markGuidanceAsShown(userId, next.category);

    await this.userEventService.log({
      userId,
      type: EventType.GUIDANCE_SHOWN,
      metadata: { category: next.category, priority: next.priority },
    });

    return next;
  }

  async getCompletionRate(_userId: number): Promise<number> {
    return 0.7; // TODO: implement
  }
}
