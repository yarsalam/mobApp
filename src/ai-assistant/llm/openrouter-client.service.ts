import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout } from 'rxjs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LLMRequest {
  userMessage: string;
  contextString: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const ASSISTANT_SYSTEM_PROMPT = `تو دستیار هوشمند یارسلام هستی — یک اپ همسریابی ایرانی.

وظیفه تو:
- کمک به کاربر برای بهتر شدن پروفایل و افزایش شانس آشنایی
- پاسخ‌های کوتاه، دوستانه، و عملی بده (فارسی)
- از داده‌های واقعی کاربر که در Context آمده استفاده کن
- هرگز اطلاعات دیگر کاربران را فاش نکن
- هرگز توصیه‌های ازدواج قطعی نده

قوانین:
- پاسخ‌ها حداکثر ۳ پاراگراف کوتاه
- emoji مناسب استفاده کن
- اگر سوال به داده‌های خارج از Context مربوط است، بگو "اطلاعات کافی ندارم"`;

const CLASSIFIER_SYSTEM_PROMPT = `تو یک classifier متنی هستی.
وظیفه‌ات تشخیص intent پیام کاربر است.
فقط یک کلمه از لیست زیر برگردان، بدون توضیح اضافه:

MY_STATS        = آمار و وضعیت پروفایل (چند بازدید، چند لایک، عملکرد)
MY_PHASE        = فاز cold/warm/hot کاربر
MY_TRUST        = امتیاز اعتماد، محدودیت اکانت
WHY_NO_REPLY    = چرا کسی جواب نمی‌دهد، احساس نادیده گرفته شدن
WHY_NOT_VISIBLE = چرا دیده نمی‌شوم، کمتر نمایش داده می‌شوم
PAYMENT_HELP    = مشکل خرید، اعتبار، VIP، بوست
GREETING        = سلام، احوالپرسی، معرفی اولیه
PROFILE_ADVICE  = راهنمایی برای بهبود پروفایل، عکس، بیو
MESSAGE_HELP    = کمک برای نوشتن پیام به طرف مقابل
ICEBREAKER      = جمله شروع گفتگو با یک نفر خاص
GENERAL_CHAT    = هر چیز دیگری

قانون: فقط یک کلمه از لیست بالا برگردان. هیچ چیز دیگری ننویس.`;

// ─── Provider Config ──────────────────────────────────────────────────────────

/**
 * اولویت‌بندی provider های رایگان:
 * 1. Google Gemini Flash (AI Studio) — رایگان، سریع، فارسی خوب
 * 2. Groq (llama-3-8b) — رایگان، بسیار سریع
 * 3. OpenRouter (mistral-7b) — fallback قدیمی
 *
 * متغیرهای محیطی:
 *   GEMINI_API_KEY     → Google AI Studio (اصلی)
 *   GROQ_API_KEY       → Groq (جایگزین)
 *   OPENROUTER_API_KEY → OpenRouter (قدیمی، هنوز پشتیبانی می‌شود)
 */

interface ProviderConfig {
  name: string;
  available: () => boolean;
  chat: (messages: GeminiMessage[], maxTokens: number) => Promise<string>;
  classify: (message: string) => Promise<string | null>;
}

interface GeminiMessage {
  role: 'user' | 'model' | 'system';
  content: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class OpenRouterClientService {
  private readonly logger = new Logger(OpenRouterClientService.name);

  constructor(private readonly httpService: HttpService) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  async ask(req: LLMRequest): Promise<string> {
    const provider = this.getProvider();
    if (!provider) {
      this.logger.warn(
        'No LLM provider configured — using rule-based fallback',
      );
      return this.fallbackResponse(req.userMessage);
    }

    // ساخت پیام‌ها با context امن
    const safeContext = this.sanitizeContext(req.contextString);
    const messages: GeminiMessage[] = [
      { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
      {
        role: 'system',
        content: `[داده‌های کاربر — فقط خواندنی]\n${safeContext}\n[پایان داده‌ها]`,
      },
      ...(req.conversationHistory ?? []).map((h) => ({
        role: h.role === 'user' ? ('user' as const) : ('model' as const),
        content: h.content,
      })),
      { role: 'user', content: req.userMessage },
    ];

    try {
      return await provider.chat(messages, req.maxTokens ?? 300);
    } catch (err) {
      this.logger.error(`${provider.name} failed: ${err}`);
      return this.fallbackResponse(req.userMessage);
    }
  }

  async classify(userMessage: string): Promise<string | null> {
    const provider = this.getProvider();
    if (!provider) return null;
    try {
      return await provider.classify(userMessage);
    } catch {
      return null;
    }
  }

  // ─── Provider Selection ───────────────────────────────────────────────────

  private getProvider(): ProviderConfig | null {
    const providers = this.buildProviders();
    return providers.find((p) => p.available()) ?? null;
  }

  private buildProviders(): ProviderConfig[] {
    return [
      this.geminiProvider(),
      this.groqProvider(),
      this.openRouterProvider(),
    ];
  }

  // ─── Google Gemini Flash (رایگان) ────────────────────────────────────────

  private geminiProvider(): ProviderConfig {
    const apiKey = process.env.GEMINI_API_KEY ?? '';
    const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash-lite'; // سریع‌ترین و رایگان

    return {
      name: 'Gemini',
      available: () => !!apiKey,

      chat: async (messages, maxTokens) => {
        // Gemini API فرمت خاص خودش رو داره
        const systemParts = messages
          .filter((m) => m.role === 'system')
          .map((m) => m.content)
          .join('\n\n');

        const conversationMessages = messages.filter(
          (m) => m.role !== 'system',
        );

        // تبدیل به فرمت Gemini
        const contents = conversationMessages.map((m) => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }],
        }));

        const body = {
          system_instruction: {
            parts: [{ text: systemParts }],
          },
          contents,
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.7,
          },
        };

        const res = await firstValueFrom(
          this.httpService
            .post(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
              body,
              { headers: { 'Content-Type': 'application/json' } },
            )
            .pipe(timeout(20_000)),
        );

        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Empty Gemini response');
        return text.trim();
      },

      classify: async (message) => {
        const body = {
          contents: [{ role: 'user', parts: [{ text: message }] }],
          systemInstruction: {
            parts: [{ text: CLASSIFIER_SYSTEM_PROMPT }],
          },
          generationConfig: {
            maxOutputTokens: 10,
            temperature: 0,
          },
        };

        const res = await firstValueFrom(
          this.httpService
            .post(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
              body,
              { headers: { 'Content-Type': 'application/json' } },
            )
            .pipe(timeout(8_000)),
        );

        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return (
          text
            ?.trim()
            .split(/[\s\n.،,]/)[0]
            .toUpperCase() ?? null
        );
      },
    };
  }

  // ─── Groq (رایگان، بسیار سریع) ──────────────────────────────────────────

  private groqProvider(): ProviderConfig {
    const apiKey = process.env.GROQ_API_KEY ?? '';
    const model = process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant'; // رایگان

    const callGroq = async (
      messages: any[],
      maxTokens: number,
      temp: number,
    ) => {
      const res = await firstValueFrom(
        this.httpService
          .post(
            'https://api.groq.com/openai/v1/chat/completions',
            { model, messages, max_tokens: maxTokens, temperature: temp },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
            },
          )
          .pipe(timeout(15_000)),
      );
      const content = res.data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty Groq response');
      return content.trim();
    };

    return {
      name: 'Groq',
      available: () => !!apiKey,

      chat: async (messages, maxTokens) => {
        // تبدیل فرمت Gemini به OpenAI
        const openAiMessages = this.convertToOpenAI(messages);
        return callGroq(openAiMessages, maxTokens, 0.7);
      },

      classify: async (message) => {
        const messages = [
          { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
          { role: 'user', content: message },
        ];
        const result = await callGroq(messages, 10, 0);
        return result.split(/[\s\n.،,]/)[0].toUpperCase();
      },
    };
  }

  // ─── OpenRouter (fallback قدیمی) ─────────────────────────────────────────

  private openRouterProvider(): ProviderConfig {
    const apiKey = process.env.OPENROUTER_API_KEY ?? '';
    const model =
      process.env.OPENROUTER_MODEL ?? 'mistralai/mistral-7b-instruct';

    const callOpenRouter = async (
      messages: any[],
      maxTokens: number,
      temp: number,
    ) => {
      const res = await firstValueFrom(
        this.httpService
          .post(
            'https://openrouter.ai/api/v1/chat/completions',
            { model, messages, max_tokens: maxTokens, temperature: temp },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://yarsalam.top',
                'X-Title': 'Yarsalam Assistant',
              },
            },
          )
          .pipe(timeout(25_000)),
      );
      const content = res.data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty OpenRouter response');
      return content.trim();
    };

    return {
      name: 'OpenRouter',
      available: () => !!apiKey,

      chat: async (messages, maxTokens) => {
        const openAiMessages = this.convertToOpenAI(messages);
        return callOpenRouter(openAiMessages, maxTokens, 0.7);
      },

      classify: async (message) => {
        const messages = [
          { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
          { role: 'user', content: message },
        ];
        const result = await callOpenRouter(messages, 10, 0);
        return result.split(/[\s\n.،,]/)[0].toUpperCase();
      },
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * تبدیل فرمت داخلی به OpenAI-compatible
   * پیام‌های system ادغام می‌شوند
   */
  private convertToOpenAI(
    messages: GeminiMessage[],
  ): Array<{ role: string; content: string }> {
    const systemContent = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const result: Array<{ role: string; content: string }> = [];
    if (systemContent) result.push({ role: 'system', content: systemContent });

    messages
      .filter((m) => m.role !== 'system')
      .forEach((m) =>
        result.push({
          role: m.role === 'model' ? 'assistant' : m.role,
          content: m.content,
        }),
      );

    return result;
  }

  /**
   * جلوگیری از Prompt Injection در context
   * تگ‌های خطرناک را حذف می‌کند
   */
  private sanitizeContext(ctx: string): string {
    return ctx
      .replace(/\[(?:END DATA|SYSTEM|BEGIN|\/SYSTEM)[^\]]*\]/gi, '[REMOVED]')
      .replace(/ignore\s+(?:previous|all)\s+instructions?/gi, '[REMOVED]')
      .replace(/(?:you\s+are\s+now|pretend\s+you)/gi, '[REMOVED]')
      .slice(0, 1500); // محدودیت طول context
  }

  private fallbackResponse(message: string): string {
    if (
      message.includes('لایک') ||
      message.includes('پاسخ') ||
      message.includes('جواب')
    )
      return '📊 برای بررسی دلیل کم بودن لایک‌ها، آمار پروفایلت رو چک کن. احتمالاً پروفایل یا عکس‌هات نیاز به بهبود داره.';
    if (message.includes('پروفایل'))
      return 'برای بهبود پروفایل: ۱) عکس باکیفیت اضافه کن ۲) درباره‌ات را کامل بنویس ۳) شهرت را مشخص کن.';
    if (message.includes('پیام'))
      return 'برای شروع گفتگو: یک سوال مشترک درباره علایق طرف مقابل بپرس. پیام کوتاه و صادقانه بهتر است.';
    return 'چطور می‌تونم کمکت کنم؟ درباره پروفایل، آمار، یا نحوه ارتباط بیشتر بگو.';
  }
}
