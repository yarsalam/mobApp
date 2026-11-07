import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Personality } from './entities/personality.entity';
import { PersonalityAIClient } from './services/personality-ai-client.service';
import {
  PersonalityWeightService,
  DEFAULT_PERSONALITY_WEIGHTS,
} from './services/personality-weight.service';
import { PersonalityLearningService } from './services/personality-learning.service';
import { User } from '../users/entities/user.entity';
import { Message } from '../message/entities/message.entity';
import { OpenRouterClientService } from '../ai-assistant/llm/openrouter-client.service';

@Injectable()
const OCEAN_AXES = [
  'openness',
  'conscientiousness',
  'extraversion',
  'agreeableness',
  'neuroticism',
] as const;

type OceanAxis = (typeof OCEAN_AXES)[number];

function normalizeEvidenceText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replaceAll('\n', ' ')
    .replaceAll('\r', ' ')
    .trim()
    .replaceAll('  ', ' ');
}

export class PersonalityService {
  private readonly logger = new Logger(PersonalityService.name);

  constructor(
    @InjectRepository(Personality)
    private readonly repo: Repository<Personality>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    private readonly aiClient: PersonalityAIClient,
    private readonly weightService: PersonalityWeightService,
    private readonly learningService: PersonalityLearningService,
    private readonly llm: OpenRouterClientService,
  ) {}

  async analyzeSentiment(messages: string[]): Promise<any> {
    return this.aiClient.analyzeSentiment(messages);
  }

  async analyzeEmotion(messages: string[]): Promise<any> {
    return this.aiClient.analyzeEmotion(messages);
  }

  async getTextAnalysisConsent(userId: number) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'metadata'],
    });
    if (!user) throw new NotFoundException('User not found');

    const consent = user.metadata?.personalityTextAnalysisConsent;
    return {
      enabled: consent?.enabled === true,
      policyVersion: consent?.policyVersion ?? null,
      grantedAt: consent?.grantedAt ?? null,
      revokedAt: consent?.revokedAt ?? null,
    };
  }

  async setTextAnalysisConsent(userId: number, enabled: boolean) {
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException('enabled must be boolean');
    }
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date().toISOString();
    const previous = user.metadata?.personalityTextAnalysisConsent ?? {};
    user.metadata = {
      ...(user.metadata ?? {}),
      personalityTextAnalysisConsent: enabled
        ? {
            enabled: true,
            policyVersion: 'ocean-text-v1',
            grantedAt: previous.grantedAt ?? now,
            updatedAt: now,
          }
        : {
            enabled: false,
            policyVersion: 'ocean-text-v1',
            grantedAt: previous.grantedAt ?? null,
            revokedAt: now,
            updatedAt: now,
          },
    };
    await this.userRepo.save(user);
    return this.getTextAnalysisConsent(userId);
  }

  async analyzeTextPersonality(userId: number) {
    const [user, consent] = await Promise.all([
      this.userRepo.findOne({ where: { id: userId } }),
      this.getTextAnalysisConsent(userId),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!consent.enabled) {
      throw new ForbiddenException(
        'برای تحلیل شخصیت از متن، رضایت جداگانه کاربر لازم است.',
      );
    }

    const profileText = [
      user.aboutme,
      ...(Array.isArray(user.hobbies_self) ? user.hobbies_self : []),
      ...(Array.isArray(user.values_self) ? user.values_self : []),
    ]
      .filter((item): item is string => typeof item === 'string')
      .join('\n')
      .trim();

    const recentOwnMessages = await this.messageRepo
      .createQueryBuilder('message')
      .where('message.from_id = :userId', { userId })
      .andWhere('message.deleted_from = false')
      .orderBy('message.created_at', 'DESC')
      .take(30)
      .getMany();

    const cleanText = (text: string) =>
      text
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}/gi, '[ایمیل حذف شد]')
        .replace(/https?:[/][/][^ ]+/gi, '[پیوند حذف شد]')
        .replace(/[+0-9][0-9+(). -]{7,}[0-9]/g, '[شماره حذف شد]')
        .slice(0, 700);

    const cleanProfile = cleanText(profileText);
    const cleanMessages = recentOwnMessages
      .map((message) => cleanText(message.content ?? ''))
      .filter((text) => text.length >= 12)
      .reverse();

    const corpus = [cleanProfile, ...cleanMessages].filter(Boolean);
    const normalizedCorpus = normalizeEvidenceText(corpus.join('\n'));
    const profileCharacters = normalizeEvidenceText(cleanProfile).length;
    const totalCharacters = normalizedCorpus.length;

    const insufficient = {
      status: 'insufficient_data',
      source: 'self_authored_profile_and_messages',
      matchingEligible: false,
      calibrated: false,
      minimumTextCharacters: 240,
      input: {
        profileCharacters,
        ownMessageCount: cleanMessages.length,
        totalCharacters,
      },
      scores: {},
      limitations: [
        'این خروجی ارزیابی روان‌سنجی یا تشخیص بالینی نیست.',
        'برای تخمین، متن خوداظهاری بیشتری لازم است.',
      ],
    };

    if (
      totalCharacters < 240 ||
      (profileCharacters < 100 && cleanMessages.length < 3)
    ) {
      await this.saveTextAssessment(userId, insufficient);
      return insufficient;
    }

    const prompt = [
      'برای پنج بُعد OCEAN فقط یک برآورد محتاطانه از شواهد نوشتاری همین فرد تهیه کن.',
      'این کار تشخیص بالینی یا نتیجه روان‌سنجی معتبر نیست.',
      'از جنسیت، سن، مذهب، درآمد، شهر، قومیت، ظاهر، وضعیت تأهل یا ویژگی حساس هیچ استنباطی نکن.',
      'میان خوداظهاری صریح و برداشت از سبک نگارش تفاوت بگذار.',
      'برای هر بُعد score بین 0 تا 1، confidence بین 0 تا 1 و حداکثر دو نقل‌قول دقیق از متن ورودی بده.',
      'اگر شواهد کافی نیست score را null بگذار و evidence را خالی کن.',
      'هیچ نقل‌قول یا واقعیتی نساز. quote باید دقیقاً از ورودی انتخاب شود.',
      'فقط JSON معتبر و بدون Markdown با این ساختار برگردان:',
      '{"scores":{"openness":{"score":null,"confidence":0,"evidence":[]},"conscientiousness":{"score":null,"confidence":0,"evidence":[]},"extraversion":{"score":null,"confidence":0,"evidence":[]},"agreeableness":{"score":null,"confidence":0,"evidence":[]},"neuroticism":{"score":null,"confidence":0,"evidence":[]}},"limitations":[]}',
    ].join('\n');

    const response = await this.llm.ask({
      userMessage: prompt,
      contextString: corpus
        .map((text, index) => '[متن خوداظهاری ' + (index + 1) + ']\n' + text)
        .join('\n\n'),
      conversationHistory: [],
      maxTokens: 900,
    });

    const jsonStart = response.indexOf('{');
    const jsonEnd = response.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      const failed = {
        ...insufficient,
        status: 'model_response_invalid',
        limitations: [...insufficient.limitations, 'پاسخ مدل ساختار قابل اعتبارسنجی نداشت.'],
      };
      await this.saveTextAssessment(userId, failed);
      return failed;
    }

    type RawDimension = {
      score?: number | null;
      confidence?: number;
      evidence?: unknown[];
    };
    type RawAssessment = {
      scores?: Partial<Record<OceanAxis, RawDimension>>;
      limitations?: unknown;
    };

    let parsed: RawAssessment;
    try {
      parsed = JSON.parse(response.slice(jsonStart, jsonEnd + 1)) as RawAssessment;
    } catch {
      const failed = {
        ...insufficient,
        status: 'model_response_invalid',
        limitations: [...insufficient.limitations, 'پاسخ مدل JSON معتبر نبود.'],
      };
      await this.saveTextAssessment(userId, failed);
      return failed;
    }

    const scores: Record<string, {
      score: number;
      confidence: number;
      evidence: string[];
      confidenceCalibration: 'uncalibrated';
    } | null> = {};

    for (const axis of OCEAN_AXES) {
      const raw = parsed.scores?.[axis];
      const score = raw?.score;
      const confidence = raw?.confidence;
      const evidence = Array.isArray(raw?.evidence)
        ? raw.evidence
            .filter((quote): quote is string => typeof quote === 'string')
            .map((quote) => quote.trim())
            .filter((quote) => {
              const normalizedQuote = normalizeEvidenceText(quote);
              return normalizedQuote.length >= 18 && normalizedCorpus.includes(normalizedQuote);
            })
            .slice(0, 2)
        : [];

      if (
        typeof score !== 'number' ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 1 ||
        evidence.length === 0
      ) {
        scores[axis] = null;
        continue;
      }

      scores[axis] = {
        score: Math.round(score * 1000) / 1000,
        confidence: Math.min(
          0.5,
          typeof confidence === 'number' && Number.isFinite(confidence)
            ? Math.max(0, confidence)
            : 0,
        ),
        evidence,
        confidenceCalibration: 'uncalibrated',
      };
    }

    const validAxes = OCEAN_AXES.filter((axis) => scores[axis] !== null).length;
    const result = {
      status: validAxes >= 3 ? 'text_estimate_uncalibrated' : 'insufficient_evidence',
      source: 'self_authored_profile_and_messages',
      assessedAt: new Date().toISOString(),
      model: process.env.PERSONALITY_TEXT_MODEL ?? 'configured-gemini-groq-openrouter-chain',
      policyVersion: consent.policyVersion,
      matchingEligible: false,
      calibrated: false,
      input: {
        profileCharacters,
        ownMessageCount: cleanMessages.length,
        totalCharacters,
      },
      scores,
      limitations: [
        'این برآورد از متن است و پرسش‌نامه روان‌سنجی معتبر محسوب نمی‌شود.',
        'confidence خروجی مدل کالیبره نشده و احتمال آماری نیست.',
        'تا زمان اعتبارسنجی فارسی، در رتبه‌بندی یا امتیاز Matching استفاده نمی‌شود.',
        ...(Array.isArray(parsed.limitations)
          ? parsed.limitations.filter((item): item is string => typeof item === 'string').slice(0, 5)
          : []),
      ],
    };

    await this.saveTextAssessment(userId, result);
    return result;
  }

  private async saveTextAssessment(
    userId: number,
    assessment: Record<string, unknown>,
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const previous = user.metadata?.personalityTextAnalysis ?? {};
    user.metadata = {
      ...(user.metadata ?? {}),
      personalityTextAnalysis: {
        ...previous,
        latestAssessment: assessment,
      },
    };
    await this.userRepo.save(user);
  }

  async analyzePersonality(userId: number) {
    const personality = await this.repo.findOne({ where: { userId } });
    if (!personality) {
      return {
        ocean: {},
        sentiment: 'neutral',
        emotion: 'neutral',
        weights: {},
      };
    }

    // ساخت ocean از ستون‌های مستقل یا JSON قدیمی
    const rawOcean = {
      openness: personality.openness ?? personality.ocean?.openness ?? 0.5,
      conscientiousness:
        personality.conscientiousness ??
        personality.ocean?.conscientiousness ??
        0.5,
      extraversion:
        personality.extraversion ?? personality.ocean?.extraversion ?? 0.5,
      agreeableness:
        personality.agreeableness ?? personality.ocean?.agreeableness ?? 0.5,
      neuroticism:
        personality.neuroticism ?? personality.ocean?.neuroticism ?? 0.5,
    };

    if (!Object.values(rawOcean).some((v) => v !== 0.5)) {
      return {
        ocean: {},
        sentiment: 'neutral',
        emotion: 'neutral',
        weights: {},
      };
    }

    // بارگذاری موازی وزن‌ها
    const weightKeys = Object.keys(DEFAULT_PERSONALITY_WEIGHTS);
    const weightValues = await Promise.all(
      weightKeys.map((k) => this.weightService.getWeight(k)),
    );
    const weights: Record<string, number> = Object.fromEntries(
      weightKeys.map((k, i) => [k, weightValues[i]]),
    );

    const weightedOcean = {
      openness: rawOcean.openness * weights.openness,
      conscientiousness: rawOcean.conscientiousness * weights.conscientiousness,
      extraversion: rawOcean.extraversion * weights.extraversion,
      agreeableness: rawOcean.agreeableness * weights.agreeableness,
      neuroticism: rawOcean.neuroticism * weights.neuroticism,
    };

    return {
      ocean: weightedOcean,
      sentiment: personality.sentiment || 'neutral',
      emotion: personality.emotion || 'neutral',
      weights,
    };
  }

  async learnFromMatch(userId1: number, userId2: number): Promise<void> {
    const [p1, p2] = await Promise.all([
      this.analyzePersonality(userId1),
      this.analyzePersonality(userId2),
    ]);

    await this.learningService.learnFromMatch(
      p1.ocean as Record<string, number>,
      p1.sentiment,
      p2.ocean as Record<string, number>,
      p2.sentiment,
    );
  }

  async updateFromMessages(userId: number, messages: string[]): Promise<void> {
    if (messages.length < 3) return;

    try {
      const [sentimentResults, emotionResults] = await Promise.all([
        this.aiClient.analyzeSentiment(messages).catch(() => null),
        this.aiClient.analyzeEmotion(messages).catch(() => null),
      ]);

      if (!sentimentResults && !emotionResults) return;

      const sentiment = this.aggregateSentiment(sentimentResults);
      const emotion = this.aggregateEmotion(emotionResults);

      await this.repo.upsert({ userId, sentiment, emotion }, ['userId']);
    } catch {
      // بدون throw — personality نباید flow اصلی رو بلاک کنه
    }
  }

  private aggregateSentiment(results: any[] | null): string {
    if (!results?.length) return 'neutral';
    const counts: Record<string, number> = {};
    for (const r of results) {
      const label = r.label?.toLowerCase() ?? 'neutral';
      const mapped = label.includes('pos')
        ? 'positive'
        : label.includes('neg')
          ? 'negative'
          : 'neutral';
      counts[mapped] = (counts[mapped] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  private aggregateEmotion(results: any[] | null): string {
    if (!results?.length) return 'neutral';
    const counts: Record<string, number> = {};
    for (const r of results) {
      const label = r.label?.toLowerCase() ?? 'neutral';
      counts[label] = (counts[label] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  async adminUpdate(userId: number, data: Record<string, any>) {
    await this.repo.upsert({ userId, ...data }, ['userId']);
    return this.analyzePersonality(userId);
  }

  async debugMatch(userId: number, candidateId: number) {
    const [p1, p2] = await Promise.all([
      this.repo.findOne({ where: { userId } }),
      this.repo.findOne({ where: { userId: candidateId } }),
    ]);
    if (!p1 || !p2) return { error: 'یک یا هر دو کاربر personality ندارند' };

    const ocean1 = {
      openness: p1.openness,
      conscientiousness: p1.conscientiousness,
      extraversion: p1.extraversion,
      agreeableness: p1.agreeableness,
      neuroticism: p1.neuroticism,
    };
    const ocean2 = {
      openness: p2.openness,
      conscientiousness: p2.conscientiousness,
      extraversion: p2.extraversion,
      agreeableness: p2.agreeableness,
      neuroticism: p2.neuroticism,
    };

    const similarity =
      Object.keys(ocean1).reduce((sum, k) => {
        return sum + (1 - Math.abs((ocean1[k] ?? 0.5) - (ocean2[k] ?? 0.5)));
      }, 0) / Object.keys(ocean1).length;

    return {
      userId,
      candidateId,
      ocean1,
      ocean2,
      similarityScore: Math.round(similarity * 100),
    };
  }
}
