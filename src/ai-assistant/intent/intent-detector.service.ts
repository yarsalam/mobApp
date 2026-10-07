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

    if (normalized.length <= 15) {
      return {
        type: IntentType.GREETING,
        needsLLM: false,
        confidence: 0.55,
        source: 'fallback',
      };
    }

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
    const phaseLabel = { cold: 'سرد', warm: 'گرم', hot: 'داغ' }[ctx.phase];
    return [
      `سلام! 👋 من دستیار یارسلام هستم.`,
      `وضعیت فعلی شما: فاز ${phaseLabel} | اعتماد ${ctx.trustScore}/100`,
      ``,
      `می‌تونم درباره آمار پروفایل، راه‌های بهبود، یا هر سوال دیگه‌ای کمکت کنم.`,
    ].join('\n');
  }

  private buildStatsResponse(ctx: UserContext): string {
    const { metrics } = ctx;
    const lines = [
      `📊 آمار ۷ روز اخیر شما:`,
      `👁 بازدید: ${metrics.views7d}`,
      `❤️ لایک: ${metrics.likes7d}`,
      `🤝 مچ: ${metrics.matches7d}`,
      `💬 پیام: ${metrics.messages7d}`,
    ];
    if (metrics.boostUsed7d > 0)
      lines.push(`🚀 بوست: ${metrics.boostUsed7d} بار`);
    lines.push(
      ``,
      `احتمال پاسخ گرفتن: ${(ctx.probabilities.response * 100).toFixed(0)}%`,
      `احتمال مچ شدن: ${(ctx.probabilities.match * 100).toFixed(0)}%`,
    );
    return lines.join('\n');
  }

  private buildPhaseResponse(ctx: UserContext): string {
    const phaseNames = {
      cold: 'سرد (Cold)',
      warm: 'گرم (Warm)',
      hot: 'داغ (Hot)',
    };
    const progress =
      ctx.nextPhaseThreshold > 0
        ? Math.min(
            100,
            Math.round((ctx.phaseScore / ctx.nextPhaseThreshold) * 100),
          )
        : 100;
    const lines = [
      `📈 فاز فعلی شما: ${phaseNames[ctx.phase]}`,
      `امتیاز: ${ctx.phaseScore.toFixed(1)} از ${ctx.nextPhaseThreshold} (${progress}%)`,
      `رتبه شما از کل کاربران: ${ctx.percentile}%`,
    ];
    if (ctx.phase !== 'hot' && ctx.suggestedActions.length > 0) {
      lines.push(``, `برای پیشرفت: ${ctx.suggestedActions[0]}`);
    } else if (ctx.phase === 'hot') {
      lines.push(``, `✅ شما در بالاترین فاز هستید!`);
    }
    return lines.join('\n');
  }

  private buildTrustResponse(ctx: UserContext): string {
    const [level, advice] =
      ctx.trustScore >= 80
        ? ['عالی ✅', 'پروفایل شما اعتماد بالایی دارد.']
        : ctx.trustScore >= 60
          ? ['خوب 👍', 'برای افزایش اعتماد، احراز هویت چهره را تکمیل کنید.']
          : [
              'نیاز به بهبود ⚠️',
              'تأیید شماره تلفن، افزودن عکس، و احراز هویت چهره را انجام دهید.',
            ];
    return `🔒 امتیاز اعتماد شما: ${ctx.trustScore}/100 (${level})\n\n${advice}`;
  }

  /**
   * FIX: این متد الان همیشه یه جواب مفید برمیگردونه.
   * قبلاً وقتی issues خالی بود، یه پیام ثابت هاردکد برمیگشت
   * ولی مشکل اصلی اینجا نبود — مشکل اینه که needsLLM: false بود
   * ولی openRouter.ask() صدا زده میشد و fallback میداد.
   */
  private buildNoReplyResponse(ctx: UserContext): string {
    const issues: string[] = [];

    if (ctx.probabilities.response < 0.15)
      issues.push(
        `• نرخ پاسخ‌گویی پایین (${(ctx.probabilities.response * 100).toFixed(0)}%) — زیر میانگین`,
      );

    if (ctx.trustScore < 50)
      issues.push(
        `• امتیاز اعتماد پایین (${ctx.trustScore}/100) — پروفایل غیررسمی به نظر میرسه`,
      );

    if (ctx.metrics.views7d > 20 && ctx.metrics.likes7d < 2)
      issues.push(
        `• ${ctx.metrics.views7d} بازدید اما فقط ${ctx.metrics.likes7d} لایک — عکس اصلی جذاب نیست`,
      );

    if (ctx.metrics.views7d === 0)
      issues.push('• پروفایل بازدید ندارد — فاز Cold محدودیت نمایش داره');

    if (ctx.phase === 'cold')
      issues.push('• فاز Cold: الگوریتم کمتر پروفایلت رو نمایش میده');

    // اگر هیچ مشکل خاصی تشخیص داده نشد، راهنمایی عمومی بده
    const mainIssues =
      issues.length > 0
        ? issues.join('\n')
        : '• فعالیت کم در اپ\n• پیام‌های عمومی بدون شخصی‌سازی\n• ساعت نامناسب ارسال پیام (بهترین: ۲۰-۲۳)';

    const suggestion =
      ctx.suggestedActions[0] ?? 'پروفایل رو کامل کن و روزانه ۵ نفر رو لایک کن';

    return `❤️ دلایل احتمالی کم بودن لایک:\n${mainIssues}\n\n💡 پیشنهاد: ${suggestion}`;
  }

  private buildVisibilityResponse(ctx: UserContext): string {
    const reasons: string[] = [];
    if (ctx.phase === 'cold')
      reasons.push('• فاز Cold: فعالیت بیشتری نیاز دارید');
    if (ctx.trustScore < 60)
      reasons.push(`• اعتماد پایین (${ctx.trustScore}/100)`);
    if (ctx.metrics.retentionDays < 3)
      reasons.push('• فعالیت کم در ۷ روز اخیر');
    if (ctx.metrics.boostUsed7d === 0) reasons.push('• بوست استفاده نشده');
    const lines = [
      'دلایل کمتر دیده شدن:',
      ...(reasons.length ? reasons : ['• اطلاعات کافی برای تحلیل وجود ندارد']),
    ];
    if (ctx.suggestedActions.length > 0)
      lines.push(`\nراه‌حل اول: ${ctx.suggestedActions[0]}`);
    return lines.join('\n');
  }

  private buildPaymentResponse(ctx: UserContext): string {
    return ctx.everPaid
      ? '💳 اعتبار شما تمام شده یا قابلیت مورد نظر نیاز به اشتراک دارد.\nبرای شارژ اعتبار به بخش پرداخت مراجعه کنید.'
      : '💳 برای ارسال پیام نیاز به اعتبار دارید.\nبا اولین خرید، می‌توانید پیام‌های نامحدود ارسال کنید.';
  }
}
