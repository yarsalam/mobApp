import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Personality } from './entities/personality.entity';
import { PersonalityAIClient } from './services/personality-ai-client.service';
import {
  PersonalityWeightService,
  DEFAULT_PERSONALITY_WEIGHTS,
} from './services/personality-weight.service';
import { PersonalityLearningService } from './services/personality-learning.service';

@Injectable()
export class PersonalityService {
  constructor(
    @InjectRepository(Personality)
    private readonly repo: Repository<Personality>,
    private readonly aiClient: PersonalityAIClient,
    private readonly weightService: PersonalityWeightService,
    private readonly learningService: PersonalityLearningService,
  ) {}

  async analyzeSentiment(messages: string[]): Promise<any> {
    return this.aiClient.analyzeSentiment(messages);
  }

  async analyzeEmotion(messages: string[]): Promise<any> {
    return this.aiClient.analyzeEmotion(messages);
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
