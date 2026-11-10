import { Injectable } from '@nestjs/common';
import { PersonalityService } from 'src/personality/personality.service';
import { PhaseService } from 'src/phase/phase.service';
import { TrustScoreService } from 'src/trust/trust-score.service';
import { UserMetricsService } from 'src/user-metrics/user-metrics.service';

export interface UserContext {
  phase: 'cold' | 'warm' | 'hot' | null;
  phaseScore: number | null;
  nextPhaseThreshold: number | null;
  percentile: number | null;
  trustScore: number | null;
  deviceRisk: number | null;
  metrics: {
    views7d: number | null;
    likes7d: number | null;
    matches7d: number | null;
    messages7d: number | null;
    boostUsed7d: number | null;
    retentionDays: number | null;
  };
  observedRates: {
    response: number | null;
    match: number | null;
    purchase: number | null;
  };
  rateSamples: {
    responseMessagesSent: number | null;
    matchLikes: number | null;
    purchaseAttempts: number | null;
  };
  personality: {
    openness: number | null;
    conscientiousness: number | null;
    extraversion: number | null;
    agreeableness: number | null;
    neuroticism: number | null;
    sentiment: string | null;
    source: string;
    status: string;
    calibrated: boolean;
  } | null;
  everPaid: boolean | null;
  suggestedActions: string[];
  builtAt: string;
}

@Injectable()
export class UserContextService {
  constructor(
    private readonly phaseService: PhaseService,
    private readonly trustScoreService: TrustScoreService,
    private readonly metricsService: UserMetricsService,
    private readonly personalityService: PersonalityService,
  ) {}

  async build(userId: number): Promise<UserContext> {
    const [phaseMetrics, trustCtx, metrics7d, intelligenceMetrics, personality] =
      await Promise.allSettled([
        this.phaseService.getPhaseMetrics(userId),
        this.trustScoreService.getTrustContext(userId),
        this.metricsService.get7dMetrics(userId),
        this.metricsService.getUserIntelligenceMetrics(userId),
        this.personalityService.analyzePersonality(userId).catch(() => null),
      ]);

    const phase = this.settled(phaseMetrics);
    const trust = this.settled(trustCtx);
    const metrics = this.settled(metrics7d);
    const intelligence = this.settled(intelligenceMetrics);
    const pers = this.settled(personality);

    const knownNumber = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    const sampleCount = (value: unknown): number | null => {
      const count = knownNumber(value);
      return count !== null && Number.isSafeInteger(count) && count >= 0
        ? count
        : null;
    };
    const measuredRate = (rate: unknown, denominator: number | null): number | null => {
      const value = knownNumber(rate);
      return denominator !== null &&
        denominator > 0 &&
        value !== null &&
        value >= 0 &&
        value <= 1
        ? value
        : null;
    };

    const knownPhase =
      phase?.phase === 'cold' || phase?.phase === 'warm' || phase?.phase === 'hot'
        ? phase.phase
        : null;

    const responseMessagesSent = sampleCount(intelligence?.messagesSent);
    const matchLikes = sampleCount(intelligence?.likes);
    const purchaseAttempts = sampleCount(intelligence?.paymentAttempts);

    const personalitySource = pers?.oceanSource;
    const hasPermittedPersonalitySource =
      personalitySource === 'validated_questionnaire' ||
      (personalitySource === 'self_authored_profile_and_messages' &&
        pers?.oceanStatus === 'text_estimate_uncalibrated');
    const ocean = hasPermittedPersonalitySource ? pers?.ocean : null;

    return {
      phase: knownPhase,
      phaseScore: knownNumber(phase?.score),
      nextPhaseThreshold: knownNumber(phase?.nextPhaseThreshold),
      percentile: knownNumber(phase?.percentile),

      trustScore: knownNumber(trust?.trustScore),
      deviceRisk: knownNumber(trust?.deviceRisk),

      metrics: {
        views7d: metrics ? knownNumber(metrics.views7d) : null,
        likes7d: metrics ? knownNumber(metrics.likes7d) : null,
        matches7d: metrics ? knownNumber(metrics.matches7d) : null,
        messages7d: metrics ? knownNumber(metrics.messages7d) : null,
        boostUsed7d: metrics ? knownNumber(metrics.boostUsed7d) : null,
        retentionDays: metrics ? knownNumber(metrics.retentionDays) : null,
      },

      // These are historical ratios, not forward-looking model probabilities.
      // A zero denominator means "no evidence", not a measured 0% rate.
      observedRates: {
        response: measuredRate(intelligence?.responseRate, responseMessagesSent),
        match: measuredRate(intelligence?.matchRate, matchLikes),
        purchase: measuredRate(intelligence?.purchaseRate, purchaseAttempts),
      },
      rateSamples: {
        responseMessagesSent,
        matchLikes,
        purchaseAttempts,
      },

      personality: ocean
        ? {
            openness: knownNumber(ocean.openness),
            conscientiousness: knownNumber(ocean.conscientiousness),
            extraversion: knownNumber(ocean.extraversion),
            agreeableness: knownNumber(ocean.agreeableness),
            neuroticism: knownNumber(ocean.neuroticism),
            sentiment:
              typeof pers?.sentiment === 'string' ? pers.sentiment : null,
            source: personalitySource,
            status: String(pers?.oceanStatus ?? 'unknown'),
            calibrated: pers?.calibrated === true,
          }
        : null,

      everPaid:
        typeof phase?.everPaid === 'boolean' ? phase.everPaid : null,
      suggestedActions: Array.isArray(phase?.suggestedActions)
        ? phase.suggestedActions.filter(
            (action): action is string => typeof action === 'string',
          )
        : [],

      builtAt: new Date().toISOString(),
    };
  }

  /** Only verified observations and eligible estimates may enter the prompt. */
  toPromptString(ctx: UserContext): string {
    const lines: string[] = [];
    if (ctx.phase) lines.push(`فاز کاربر: ${ctx.phase}`);
    if (ctx.phaseScore !== null && ctx.nextPhaseThreshold !== null) {
      lines.push(
        `امتیاز فاز: ${ctx.phaseScore.toFixed(1)} از آستانه ${ctx.nextPhaseThreshold}`,
      );
    }
    if (ctx.trustScore !== null) {
      lines.push(`امتیاز اعتماد ثبت‌شده: ${ctx.trustScore}/100`);
    }
    if (ctx.deviceRisk !== null) {
      lines.push(`ریسک دستگاه ثبت‌شده: ${ctx.deviceRisk}/100`);
    }

    const knownMetrics = [
      ctx.metrics.views7d === null ? null : `${ctx.metrics.views7d} بازدید`,
      ctx.metrics.likes7d === null ? null : `${ctx.metrics.likes7d} لایک`,
      ctx.metrics.matches7d === null ? null : `${ctx.metrics.matches7d} مچ`,
      ctx.metrics.messages7d === null ? null : `${ctx.metrics.messages7d} پیام`,
    ].filter((value): value is string => value !== null);
    if (knownMetrics.length) {
      lines.push(`۷ روز اخیر: ${knownMetrics.join('، ')}`);
    }

    if (
      ctx.observedRates.response !== null &&
      ctx.rateSamples.responseMessagesSent !== null
    ) {
      lines.push(
        `نرخ پاسخ تاریخی: ${(ctx.observedRates.response * 100).toFixed(0)}% از ${ctx.rateSamples.responseMessagesSent} پیام ارسالی؛ این نسبت گذشته است، نه پیش‌بینی پاسخ آینده.`,
      );
    }
    if (
      ctx.observedRates.match !== null &&
      ctx.rateSamples.matchLikes !== null
    ) {
      lines.push(
        `نرخ تبدیل Like به Match تاریخی: ${(ctx.observedRates.match * 100).toFixed(0)}% از ${ctx.rateSamples.matchLikes} لایک ثبت‌شده.`,
      );
    }
    if (
      ctx.observedRates.purchase !== null &&
      ctx.rateSamples.purchaseAttempts !== null
    ) {
      lines.push(
        `نرخ موفقیت خرید تاریخی: ${(ctx.observedRates.purchase * 100).toFixed(0)}% از ${ctx.rateSamples.purchaseAttempts} تلاش پرداخت.`,
      );
    }

    if (ctx.personality) {
      const p = ctx.personality;
      const axes = [
        p.openness === null ? null : `گشودگی=${p.openness.toFixed(2)}`,
        p.conscientiousness === null ? null : `وظیفه‌شناسی=${p.conscientiousness.toFixed(2)}`,
        p.extraversion === null ? null : `برون‌گرایی=${p.extraversion.toFixed(2)}`,
        p.agreeableness === null ? null : `توافق‌پذیری=${p.agreeableness.toFixed(2)}`,
        p.neuroticism === null ? null : `روان‌رنجوری=${p.neuroticism.toFixed(2)}`,
      ].filter((value): value is string => value !== null);
      if (axes.length) {
        lines.push(
          `برآورد OCEAN (${p.source}; ${p.calibrated ? 'کالیبره‌شده' : 'کالیبره‌نشده'}): ${axes.join('، ')}. این داده تشخیص یا حقیقت قطعی نیست.`,
        );
      }
      if (p.sentiment) lines.push(`تحلیل احساس ثبت‌شده: ${p.sentiment}`);
    }

    if (ctx.everPaid === true) lines.push('وضعیت خرید: حداقل یک خرید موفق ثبت شده است');
    if (ctx.everPaid === false) lines.push('وضعیت خرید: خرید موفقی ثبت نشده است');
    if (ctx.suggestedActions.length > 0) {
      lines.push(`پیشنهاد ثبت‌شده سیستم: ${ctx.suggestedActions[0]}`);
    }
    return lines.join('\n') || 'اطلاعات تأییدشده کافی برای ساخت زمینه شخصی در دسترس نیست.';
  }

  private settled<T>(result: PromiseSettledResult<T>): T | null {
    return result.status === 'fulfilled' ? result.value : null;
  }
}
