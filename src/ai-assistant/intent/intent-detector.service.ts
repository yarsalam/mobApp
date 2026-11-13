import { Injectable, Logger } from '@nestjs/common';
import { OpenRouterClientService } from '../llm/openrouter-client.service';
import { UserContext } from '../context/user-context.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export enum IntentType {
  MY_STATS = 'MY_STATS',
  MY_PHASE = 'MY_PHASE',
  MY_TRUST = 'MY_TRUST',
  WHY_NO_REPLY = 'WHY_NO_REPLY',
  WHY_NOT_VISIBLE = 'WHY_NOT_VISIBLE',
  PAYMENT_HELP = 'PAYMENT_HELP',
  GREETING = 'GREETING',
  PROFILE_ADVICE = 'PROFILE_ADVICE',
  MESSAGE_HELP = 'MESSAGE_HELP',
  ICEBREAKER = 'ICEBREAKER',
  GENERAL_CHAT = 'GENERAL_CHAT',
}

export interface DetectedIntent {
  type: IntentType;
  needsLLM: boolean;
  confidence: number;
  source: 'rule' | 'llm_classifier' | 'fallback';
}

// ─── Pattern Registry ─────────────────────────────────────────────────────────

interface PatternEntry {
  intent: IntentType;
  needsLLM: boolean;
  confidence: number;
  patterns: RegExp[];
}

const RULE_CONFIDENCE_THRESHOLD = 0.75;

const PATTERNS: PatternEntry[] = [
  // ── Greeting ──────────────────────────────────────────────────────────────
  {
    intent: IntentType.GREETING,
    needsLLM: false,
    confidence: 0.95,
    patterns: [
      /^سلا+م[\s!‼️🙏👋😊،,.]*$/i,
      /^سلام[\s،,]*(خوبی|چطوری|حالت|حالتون|عزیزم|دوستم|دوست من)[\s?؟!]*$/i,
      /^(سلاممم+|سلامـ+)[\s!]*$/i,
      /^[\u{1F300}-\u{1FFFF}\s]*سلام[\u{1F300}-\u{1FFFF}\s!]*$/iu,
      /^(درود|خوش آمدی|هلو|hi+|hello+|hey+|yo)[\s!‼️]*$/i,
      /^(👋|🙏|😊|🤗)+$/,
    ],
  },

  // ── Stats ──────────────────────────────────────────────────────────────────
  {
    intent: IntentType.MY_STATS,
    needsLLM: false,
    confidence: 0.9,
    patterns: [
      /چند (تا )?(بازدید|لایک|مچ|پیام)/i,
      /آمار (من|پروفایل(م)?)/i,
      /وضعیت (من|پروفایلم)/i,
      /چقدر دیده (شدم|می‌?شم)/i,
      /عملکرد (من|پروفایل(م)?)/i,
      /چند نفر (پروفایلم رو|منو) دید/i,
    ],
  },

  // ── Phase ──────────────────────────────────────────────────────────────────
  {
    intent: IntentType.MY_PHASE,
    needsLLM: false,
    confidence: 0.9,
    patterns: [
      /فاز (من|فعلی(م)?)/i,
      /مرحله (من|الان(م)?)/i,
      /چطور (وارد|به) فاز/i,
      /\b(hot|warm|cold)\b/i,
      /فاز (cold|warm|hot|سرد|گرم|داغ)/i,
    ],
  },

  // ── Trust ──────────────────────────────────────────────────────────────────
  {
    intent: IntentType.MY_TRUST,
    needsLLM: false,
    confidence: 0.9,
    patterns: [
      /اعتماد (من|پروفایل(م)?)/i,
      /\btrust\b/i,
      /اعتبار(م)? چقدر/i,
      /محدودیت (اکانت|حساب(م)?)/i,
      /امتیاز اعتماد/i,
    ],
  },

  // ── Why no reply ─────────────────────────────────────────────────────────
  {
    intent: IntentType.WHY_NO_REPLY,
    needsLLM: false, // ← rule-based کافیه، اگر LLM بخوایم true میکنیم
    confidence: 0.8,
    patterns: [
      /چرا (کسی |)(جواب|پاسخ)/i,
      /جواب نمی(‌| )?(ده|گیر)/i,
      /پاسخ نمی(‌| )?(ده|گیر)/i,
      /کسی (منو|بهم) (انتخاب|لایک) نمی/i,
      /چرا کسی بهم (پیام|توجه) نمی(‌| )?ده/i,
      /احساس (می‌?کنم|میکنم) کسی (بهم توجه|جواب)/i,
      /\bghost(ed)?\b/i,
      /نادیده (گرفته|می‌?شم)/i,
      // ── اضافه شده: سوال مستقیم "چرا لایک نمیگیرم"
      /چرا (لایک|بازدید|مچ) نمی(‌| )?(گیر|ش)/i,
      /لایک (کم|نمی‌?گیر)/i,
      /کسی لایک نمی‌?کنه/i,
    ],
  },

  // ── Visibility ────────────────────────────────────────────────────────────
  {
    intent: IntentType.WHY_NOT_VISIBLE,
    needsLLM: false,
    confidence: 0.8,
    patterns: [
      /چرا (کمتر|کم) (دیده|نمایش)/i,
      /دیده نمی(‌| )?شم/i,
      /نمایش (کم|پایین)(ه| هست)?/i,
      /کمتر (نمایش|دیده)/i,
      /\bvisibility\b/i,
      /چرا (پروفایلم|من) کمتر/i,
    ],
  },

  // ── Payment ───────────────────────────────────────────────────────────────
  {
    intent: IntentType.PAYMENT_HELP,
    needsLLM: false,
    confidence: 0.9,
    patterns: [
      /چرا نمی(‌| )?تون(م|ه) پیام/i,
      /اعتبار (تموم|خالی|کم)(ه| شده)?/i,
      /\b(خرید|پرداخت|vip|بوست)\b/i,
      /قفل شده/i,
      /پکیج/i,
    ],
  },

  // ── Profile advice ────────────────────────────────────────────────────────
  {
    intent: IntentType.PROFILE_ADVICE,
    needsLLM: true,
    confidence: 0.85,
    patterns: [
      /پروفایل(م)? (رو|را) (چطور|چجوری|بهتر)/i,
      /عکس(م)? (رو|را) (چطور|بهتر)/i,
      /درباره(‌| )?(ام|م) (رو|را) بنویس/i,
      /بیو/i,
      /پروفایلم (خوبه|بده|ضعیفه)\??/i,
    ],
  },

  // ── Message help ──────────────────────────────────────────────────────────
  {
    intent: IntentType.MESSAGE_HELP,
    needsLLM: true,
    confidence: 0.85,
    patterns: [
      /چی (بگم|بنویسم|بفرستم)/i,
      /پیام (اول|شروع)/i,
      /شروع (گفتگو|مکالمه)/i,
      /suggest.*(reply|پاسخ)/i,
      /چطور (پیام|شروع) کنم/i,
    ],
  },

  // ── Icebreaker ────────────────────────────────────────────────────────────
  {
    intent: IntentType.ICEBREAKER,
    needsLLM: true,
    confidence: 0.85,
    patterns: [/\bicebreaker\b/i, /جمله (شروع|اول)/i, /چطور (شروع|آشنا)/i],
  },
];

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class IntentDetectorService {
  private readonly logger = new Logger(IntentDetectorService.name);

  constructor(private readonly openRouter: OpenRouterClientService) {}

  /**
   * Hybrid intent detection:
   * ۱. Rule-based — اگر confidence بالا باشد → برمی‌گردد
   * ۲. LLM classifier — با متد classify() صحیح
   * ۳. Fallback
   */
  async detect(message: string, ctx?: UserContext): Promise<DetectedIntent> {
    const normalized = message.trim();

    // مرحله ۱: rule-based
    const ruleResult = this.detectByRules(normalized);
    if (ruleResult && ruleResult.confidence >= RULE_CONFIDENCE_THRESHOLD) {
      return { ...ruleResult, source: 'rule' };
    }

    // مرحله ۲: LLM classifier
    // ← FIX: از openRouter.classify() استفاده می‌کنیم، نه ask()
    try {
      const llmToken = await this.openRouter.classify(normalized);
      if (llmToken) {
        const token = llmToken.toUpperCase();
        const isValid = Object.values(IntentType).includes(token as IntentType);
        if (isValid) {
          const llmIntent = token as IntentType;
          this.logger.debug(
            `LLM classified: "${normalized.slice(0, 40)}" → ${llmIntent}`,
          );
          return {
            type: llmIntent,
            needsLLM: this.isLLMRequired(llmIntent),
            confidence: 0.8,
            source: 'llm_classifier',
          };
        }
      }
    } catch (err) {
      this.logger.warn(`LLM classifier failed, using fallback: ${err}`);
    }

    // مرحله ۳: fallback
    if (ruleResult) return { ...ruleResult, source: 'rule' };

    return {
      type: IntentType.GENERAL_CHAT,
      needsLLM: true,
      confidence: 0.5,
      source: 'fallback',
    };
  }

  // ─── Rule Engine ────────────────────────────────────────────────────────────

  private detectByRules(
    normalized: string,
  ): Omit<DetectedIntent, 'source'> | null {
    for (const entry of PATTERNS) {
      for (const pattern of entry.patterns) {
        if (pattern.test(normalized)) {
          return {
            type: entry.intent,
            needsLLM: entry.needsLLM,
            confidence: entry.confidence,
          };
        }
      }
    }
    return null;
  }

  private isLLMRequired(intent: IntentType): boolean {
    return [
      IntentType.PROFILE_ADVICE,
      IntentType.MESSAGE_HELP,
      IntentType.ICEBREAKER,
      IntentType.GENERAL_CHAT,
    ].includes(intent);
  }

  // ─── Rule-Based Response Builder ────────────────────────────────────────────

  buildRuleBasedResponse(
    intent: DetectedIntent,
    ctx: UserContext,
  ): string | null {
    switch (intent.type) {
      case IntentType.GREETING:
        return this.buildGreetingResponse(ctx);
      case IntentType.MY_STATS:
        return this.buildStatsResponse(ctx);
      case IntentType.MY_PHASE:
        return this.buildPhaseResponse(ctx);
      case IntentType.MY_TRUST:
        return this.buildTrustResponse(ctx);
      case IntentType.WHY_NO_REPLY:
        return this.buildNoReplyResponse(ctx);
      case IntentType.WHY_NOT_VISIBLE:
        return this.buildVisibilityResponse(ctx);
      case IntentType.PAYMENT_HELP:
        return this.buildPaymentResponse(ctx);
      default:
        return null;
    }
  }

  // ─── Response Builders ────────────────────────────────────────────────────

  private buildGreetingResponse(ctx: UserContext): string {
    const phaseNames = { cold: 'سرد', warm: 'گرم', hot: 'داغ' } as const;
    const details: string[] = [];
    if (ctx.phase) details.push(`فاز فعلی: ${phaseNames[ctx.phase]}`);
    if (ctx.trustScore !== null) details.push(`امتیاز اعتماد ثبت‌شده: ${ctx.trustScore}/100`);
    return [
      'سلام! 👋 من دستیار یارسلام هستم.',
      details.length ? details.join(' | ') : 'هنوز اطلاعات تأییدشده کافی برای نمایش وضعیت شخصی شما در دسترس نیست.',
      '',
      'می‌تونم درباره آمار پروفایل، راه‌های بهبود، یا هر سوال دیگه‌ای کمکت کنم.',
    ].join('\n');
  }

  private buildStatsResponse(ctx: UserContext): string {
    const metrics = ctx.metrics;
    const lines = ['📊 آمار ۷ روز اخیر شما:'];
    const metricRows: Array<[string, number | null]> = [
      ['👁 بازدید', metrics.views7d],
      ['❤️ لایک', metrics.likes7d],
      ['🤝 مچ', metrics.matches7d],
      ['💬 پیام', metrics.messages7d],
    ];
    for (const [label, value] of metricRows) {
      lines.push(`${label}: ${value === null ? 'داده در دسترس نیست' : value}`);
    }
    if (metrics.boostUsed7d !== null && metrics.boostUsed7d > 0) {
      lines.push(`🚀 بوست: ${metrics.boostUsed7d} بار`);
    } else if (metrics.boostUsed7d === null) {
      lines.push('🚀 بوست: داده در دسترس نیست');
    }
    if (
      ctx.observedRates.response !== null &&
      ctx.rateSamples.responseMessagesSent !== null
    ) {
      lines.push(
        `نرخ پاسخ تاریخی: ${(ctx.observedRates.response * 100).toFixed(0)}% از ${ctx.rateSamples.responseMessagesSent} پیام ارسالی؛ پیش‌بینی پاسخ آینده نیست.`,
      );
    }
    if (
      ctx.observedRates.match !== null &&
      ctx.rateSamples.matchLikes !== null
    ) {
      lines.push(
        `نرخ تبدیل Like به Match تاریخی: ${(ctx.observedRates.match * 100).toFixed(0)}% از ${ctx.rateSamples.matchLikes} لایک.`,
      );
    }
    if (
      ctx.observedRates.response === null &&
      ctx.observedRates.match === null
    ) {
      lines.push('نرخ تاریخی پاسخ/مچ به علت نبود نمونه معتبر قابل محاسبه نیست.');
    }
    return lines.join('\n');
  }

  private buildPhaseResponse(ctx: UserContext): string {
    const phaseNames = {
      cold: 'سرد (Cold)',
      warm: 'گرم (Warm)',
      hot: 'داغ (Hot)',
    } as const;
    if (!ctx.phase) {
      return '📈 در حال حاضر داده کافی برای تعیین فاز کاربری شما در دسترس نیست.';
    }

    const lines = [`📈 فاز فعلی شما: ${phaseNames[ctx.phase]}`];
    if (ctx.phaseScore !== null && ctx.nextPhaseThreshold !== null) {
      const progress =
        ctx.nextPhaseThreshold > 0
          ? Math.min(100, Math.round((ctx.phaseScore / ctx.nextPhaseThreshold) * 100))
          : null;
      lines.push(
        progress === null
          ? `امتیاز فاز: ${ctx.phaseScore.toFixed(1)}`
          : `امتیاز: ${ctx.phaseScore.toFixed(1)} از ${ctx.nextPhaseThreshold} (${progress}%)`,
      );
    } else {
      lines.push('امتیاز/آستانه فاز: داده معتبر در دسترس نیست');
    }
    if (ctx.percentile !== null) {
      lines.push(`رتبه درصدی ثبت‌شده: ${ctx.percentile}%`);
    }
    if (ctx.phase !== 'hot' && ctx.suggestedActions.length > 0) {
      lines.push('', `برای پیشرفت: ${ctx.suggestedActions[0]}`);
    } else if (ctx.phase === 'hot') {
      lines.push('', '✅ شما در بالاترین فاز ثبت‌شده هستید!');
    }
    return lines.join('\n');
  }

  private buildTrustResponse(ctx: UserContext): string {
    if (ctx.trustScore === null) {
      return '🔒 امتیاز اعتماد شما فعلاً قابل نمایش نیست؛ سرویس یا داده معتبر اعتماد در دسترس نیست.';
    }
    const [level, advice] =
      ctx.trustScore >= 80
        ? ['عالی ✅', 'امتیاز ثبت‌شده شما در بازه بالا قرار دارد.']
        : ctx.trustScore >= 60
          ? ['خوب 👍', 'برای افزایش اعتماد، مراحل تکمیل و تأیید پروفایل را بررسی کنید.']
          : [
              'نیاز به بررسی ⚠️',
              'اطلاعات پروفایل و مراحل تأیید حساب را بررسی کنید.',
            ];
    return `🔒 امتیاز اعتماد ثبت‌شده شما: ${ctx.trustScore}/100 (${level})\n\n${advice}`;
  }

  private buildNoReplyResponse(ctx: UserContext): string {
    const issues: string[] = [];

    if (
      ctx.observedRates.response !== null &&
      ctx.observedRates.response < 0.15 &&
      ctx.rateSamples.responseMessagesSent !== null
    ) {
      issues.push(
        `• نرخ پاسخ تاریخی پایین است (${(ctx.observedRates.response * 100).toFixed(0)}% از ${ctx.rateSamples.responseMessagesSent} پیام ارسالی). این سابقه علت قطعی کم‌پاسخی فعلی نیست.`,
      );
    }

    if (ctx.trustScore !== null && ctx.trustScore < 50) {
      issues.push(`• امتیاز اعتماد ثبت‌شده: ${ctx.trustScore}/100`);
    }

    if (
      ctx.metrics.views7d !== null &&
      ctx.metrics.likes7d !== null &&
      ctx.metrics.views7d > 20 &&
      ctx.metrics.likes7d < 2
    ) {
      issues.push(
        `• ${ctx.metrics.views7d} بازدید و ${ctx.metrics.likes7d} لایک در ۷ روز اخیر ثبت شده است؛ این یک نشانه برای بررسی پروفایل است، نه اثبات علت.`,
      );
    }

    if (ctx.metrics.views7d === 0) {
      issues.push('• در ۷ روز اخیر بازدیدی برای پروفایل ثبت نشده است.');
    }
    if (ctx.phase === 'cold') {
      issues.push('• فاز ثبت‌شده حساب Cold است.');
    }

    if (issues.length === 0) {
      return [
        '❤️ علت کم بودن پاسخ یا لایک با داده‌های فعلی قابل تعیین نیست.',
        'برای تحلیل دقیق‌تر به آمار معتبر بازدید، تعامل و وضعیت نمایش پروفایل نیاز داریم.',
        ...(ctx.suggestedActions.length
          ? [`پیشنهاد ثبت‌شده سیستم: ${ctx.suggestedActions[0]}`]
          : []),
      ].join('\n\n');
    }

    return [
      '❤️ نشانه‌های قابل مشاهده (نه علت قطعی):',
      issues.join('\n'),
      ...(ctx.suggestedActions.length
        ? ['', `💡 پیشنهاد ثبت‌شده: ${ctx.suggestedActions[0]}`]
        : []),
    ].join('\n');
  }

  private buildVisibilityResponse(ctx: UserContext): string {
    const reasons: string[] = [];
    if (ctx.phase === 'cold') reasons.push('• فاز ثبت‌شده حساب Cold است.');
    if (ctx.trustScore !== null && ctx.trustScore < 60) {
      reasons.push(`• امتیاز اعتماد ثبت‌شده: ${ctx.trustScore}/100`);
    }
    if (ctx.metrics.retentionDays !== null && ctx.metrics.retentionDays < 3) {
      reasons.push('• در کمتر از ۳ روز از ۷ روز اخیر فعالیت ثبت شده است.');
    }
    if (ctx.metrics.boostUsed7d === 0) reasons.push('• در ۷ روز اخیر بوستی ثبت نشده است.');
    if (reasons.length === 0) {
      reasons.push('• اطلاعات کافی برای شناسایی علت کمتر دیده‌شدن وجود ندارد.');
    }
    const lines = ['دلایل/نشانه‌های قابل مشاهده درباره نمایش پروفایل:', ...reasons];
    if (ctx.suggestedActions.length > 0) {
      lines.push(`\nپیشنهاد ثبت‌شده سیستم: ${ctx.suggestedActions[0]}`);
    }
    return lines.join('\n');
  }

  private buildPaymentResponse(ctx: UserContext): string {
    if (ctx.everPaid === null) {
      return '💳 سابقه خرید شما در حال حاضر قابل راستی‌آزمایی نیست. برای بررسی اعتبار یا خرید، وضعیت کیف پول را در اپ مشاهده کنید.';
    }
    return ctx.everPaid
      ? '💳 سابقه حداقل یک خرید موفق برای حساب شما ثبت شده است. برای وضعیت فعلی اعتبار، موجودی کیف پول را بررسی کنید.'
      : '💳 سابقه خرید موفقی برای حساب شما ثبت نشده است. برای مشاهده امکانات و بسته‌ها، بخش پرداخت را بررسی کنید.';
  }

}
