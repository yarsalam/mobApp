import { Injectable, Logger } from '@nestjs/common';
import { FeatureStoreService } from 'src/feature-store/feature-store.service';
import { PersonalityService } from 'src/personality/personality.service';
import { PhaseService } from 'src/phase/phase.service';
import { TrustScoreService } from 'src/trust/trust-score.service';
import { UserMetricsService } from 'src/user-metrics/user-metrics.service';

// ─── Output Type ──────────────────────────────────────────────────────────────

export interface UserContext {
  // فاز و امتیاز
  phase: 'cold' | 'warm' | 'hot';
  phaseScore: number;
  nextPhaseThreshold: number;
  percentile: number;

  // اعتماد
  trustScore: number;
  deviceRisk: number;

  // متریک‌های ۷ روز اخیر
  metrics: {
    views7d: number;
    likes7d: number;
    matches7d: number;
    messages7d: number;
    boostUsed7d: number;
    retentionDays: number;
  };

  // احتمالات از Feature Store
  probabilities: {
    response: number; // احتمال پاسخ گرفتن (0–1)
    match: number; // احتمال مچ شدن (0–1)
    purchase: number; // احتمال خرید (0–1)
  };

  // شخصیت OCEAN
  personality: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
    sentiment: string;
  } | null;

  // وضعیت خرید
  everPaid: boolean;
  suggestedActions: string[];

  // متادیتا
  builtAt: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class UserContextService {
  private readonly logger = new Logger(UserContextService.name);

  constructor(
    private readonly phaseService: PhaseService,
    private readonly featureStore: FeatureStoreService,
    private readonly trustScoreService: TrustScoreService,
    private readonly metricsService: UserMetricsService,
    private readonly personalityService: PersonalityService,
  ) {}

  async build(userId: number): Promise<UserContext> {
    const [phaseMetrics, trustCtx, metrics7d, features, personality] =
      await Promise.allSettled([
        this.phaseService.getPhaseMetrics(userId),
        this.trustScoreService.getTrustContext(userId),
        this.metricsService.get7dMetrics(userId),
        this.featureStore.getUserFeatures(userId).catch(() => null),
        this.personalityService.analyzePersonality(userId).catch(() => null),
      ]);

    const phase = this.settled(phaseMetrics);
    const trust = this.settled(trustCtx);
    const metrics = this.settled(metrics7d);
    const feat = this.settled(features);
    const pers = this.settled(personality);

    return {
      phase: (phase?.phase as any) ?? 'cold',
      phaseScore: phase?.score ?? 0,
      nextPhaseThreshold: phase?.nextPhaseThreshold ?? 15,
      percentile: phase?.percentile ?? 0,

      trustScore: trust?.trustScore ?? 50,
      deviceRisk: trust?.deviceRisk ?? 0,

      metrics: {
        views7d: Number(metrics?.views7d ?? 0),
        likes7d: Number(metrics?.likes7d ?? 0),
        matches7d: Number(metrics?.matches7d ?? 0),
        messages7d: Number(metrics?.messages7d ?? 0),
        boostUsed7d: Number(metrics?.boostUsed7d ?? 0),
        retentionDays: Number(metrics?.retentionDays ?? 0),
      },

      probabilities: {
        response: feat?.responseProbability ?? 0.2,
        match: feat?.matchProbability ?? 0.1,
        purchase: feat?.purchaseProbability ?? 0.05,
      },

      personality: pers?.ocean
        ? {
            openness: (pers.ocean as any).openness ?? 0.5,
            conscientiousness: (pers.ocean as any).conscientiousness ?? 0.5,
            extraversion: (pers.ocean as any).extraversion ?? 0.5,
            agreeableness: (pers.ocean as any).agreeableness ?? 0.5,
            neuroticism: (pers.ocean as any).neuroticism ?? 0.5,
            sentiment: (pers as any).sentiment ?? 'neutral',
          }
        : null,

      everPaid: phase?.everPaid ?? false,
      suggestedActions: phase?.suggestedActions ?? [],

      builtAt: new Date().toISOString(),
    };
  }

  /** خلاصه context برای Prompt — فارسی، مختصر */
  toPromptString(ctx: UserContext): string {
    const lines: string[] = [
      `فاز کاربر: ${ctx.phase} (امتیاز: ${ctx.phaseScore.toFixed(1)} از ${ctx.nextPhaseThreshold})`,
      `اعتماد: ${ctx.trustScore}/100`,
      `۷ روز اخیر: ${ctx.metrics.views7d} بازدید، ${ctx.metrics.likes7d} لایک، ${ctx.metrics.matches7d} مچ، ${ctx.metrics.messages7d} پیام`,
      `احتمال پاسخ: ${(ctx.probabilities.response * 100).toFixed(0)}%`,
      `احتمال مچ: ${(ctx.probabilities.match * 100).toFixed(0)}%`,
    ];

    if (ctx.personality) {
      const p = ctx.personality;
      lines.push(
        `شخصیت: برون‌گرایی=${p.extraversion.toFixed(2)}, توافق‌پذیری=${p.agreeableness.toFixed(2)}, احساس=${p.sentiment}`,
      );
    }

    if (ctx.everPaid) lines.push('وضعیت: کاربر پرداخت‌کننده');
    if (ctx.suggestedActions.length > 0) {
      lines.push(`پیشنهاد سیستم: ${ctx.suggestedActions[0]}`);
    }

    return lines.join('\n');
  }

  private settled<T>(result: PromiseSettledResult<T>): T | null {
    return result.status === 'fulfilled' ? result.value : null;
  }
}
