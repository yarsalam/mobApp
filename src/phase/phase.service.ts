import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { UserPhase } from './entities/user-phase.entity';
import { UserMetricsService } from '../user-metrics/user-metrics.service';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { FeatureStoreService } from 'src/feature-store/feature-store.service';
import { User } from 'src/users/entities/user.entity';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { Interaction } from 'src/interaction/entities/interaction.entity';
import { Message } from 'src/message/entities/message.entity';
import { EventType } from 'src/user-event/type/event-type.enum';
import { PersonalityService } from 'src/personality/personality.service';

const WEIGHT_TTL = 86400 * 90; // 90 روز

export interface PhaseWeights {
  matches: number;
  messages: number;
  views: number;
  retentionDays: number;
  boostUsed: number;
  cityUsers: number;
  learningScore: number;
  profileCompleteness: number;
  sentimentScore: number;
}

const DEFAULT_WEIGHTS: PhaseWeights = {
  matches: 2.5,
  messages: 2.0,
  views: 0.3,
  retentionDays: 1.5,
  boostUsed: 1.0,
  cityUsers: 5.0,
  learningScore: 4.0,
  profileCompleteness: 4.0,
  sentimentScore: 2.0,
};

@Injectable()
export class PhaseService {
  private readonly logger = new Logger(PhaseService.name);

  constructor(
    @InjectRepository(UserPhase)
    private readonly repo: Repository<UserPhase>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,

    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,

    @InjectRepository(Interaction)
    private readonly interactionRepo: Repository<Interaction>,

    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,

    private readonly metricsService: UserMetricsService,
    private readonly featureStore: FeatureStoreService,
    private readonly personalityService: PersonalityService,
  ) {}

  // ─── Dynamic Weights ──────────────────────────────────────────────────────

  async getWeight(key: keyof PhaseWeights): Promise<number> {
    const stored = await this.redis.get(`phase:weight:${key}`);
    return stored ? parseFloat(stored) : DEFAULT_WEIGHTS[key];
  }

  async setWeight(key: keyof PhaseWeights, value: number): Promise<void> {
    await this.redis.set(
      `phase:weight:${key}`,
      value.toString(),
      'EX',
      WEIGHT_TTL,
    );
  }

  async getAllWeights(): Promise<PhaseWeights> {
    const keys = Object.keys(DEFAULT_WEIGHTS) as (keyof PhaseWeights)[];
    const values = await Promise.all(keys.map((k) => this.getWeight(k)));
    return Object.fromEntries(
      keys.map((k, i) => [k, values[i]]),
    ) as unknown as PhaseWeights;
  }

  // ─── Learning Score ───────────────────────────────────────────────────────

  async calculateLearningScore(userId: number): Promise<number> {
    const cacheKey = `phase:learning_score:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return parseFloat(cached);

    const [events, interactions, messages] = await Promise.all([
      this.eventRepo.find({ where: { userId }, take: 100 }),
      // FIX: sender relation با nested where — TypeORM این را درست resolve می‌کند
      this.interactionRepo.find({
        where: { sender: { id: userId } },
        take: 500,
      }),
      // FIX: from_id و created_at در Message entity صریح تعریف شده‌اند — درست است
      this.messageRepo.find({
        where: { from_id: userId },
        order: { created_at: 'DESC' },
        take: 200,
        select: { content: true },
      }),
    ]);

    const usedFeatures = new Set(events.map((e) => e.type));
    const featureDiversity = Math.min(usedFeatures.size / 10, 1) * 100;

    const likes = interactions.filter((i) => i.type === 'like').length;
    const matchCount = await this.eventRepo.count({
      where: { userId, type: EventType.MATCH },
    });
    const likeToMatchRate = likes > 0 ? (matchCount / likes) * 100 : 0;

    const messageDepth = this.calculateMessageDepth(messages);
    const slope = await this.metricsService.getEngagementSlope(userId);

    const guidanceRaw = await this.redis.get(`guidance:completion:${userId}`);
    const guidanceCompletion = guidanceRaw ? parseFloat(guidanceRaw) : 0;

    const learningScore =
      featureDiversity * 0.25 +
      likeToMatchRate * 0.25 +
      messageDepth * 0.2 +
      guidanceCompletion * 0.2 +
      slope * 100 * 0.1;

    const result = Math.round(learningScore * 100) / 100;
    await this.redis.set(cacheKey, result.toString(), 'EX', 600);

    return result;
  }

  private calculateMessageDepth(messages: Array<{ content?: string }>): number {
    if (messages.length === 0) return 0;

    const contents = messages
      .map((m) => m.content ?? '')
      .filter((c) => c.trim().length > 0);

    if (contents.length === 0) return 0;

    const avgLength =
      contents.reduce((sum, c) => sum + c.length, 0) / contents.length;

    const uniqueMessages = new Set(contents.map((c) => c.trim().toLowerCase()));
    const diversityRatio = uniqueMessages.size / contents.length;

    return Math.min((avgLength / 100) * diversityRatio * 100, 100);
  }

  // ─── Phase Calculation ────────────────────────────────────────────────────

  async calculate(userId: number, externalMetrics?: any): Promise<UserPhase> {
    try {
      // FIX: قبلاً فقط get7dMetrics صدا زده می‌شد و retentionDays، cityUsers، pastPayments
      // همیشه undefined بودند. حالا هر سه منبع موازی fetch می‌شوند.
      const [raw7d, extraMetrics, user] = await Promise.all([
        externalMetrics
          ? Promise.resolve(externalMetrics)
          : this.metricsService.get7dMetrics(userId),
        this.metricsService.buildExtraMetrics(userId),
        this.userRepo.findOne({ where: { id: userId } }),
      ]);

      // تعداد کاربران هم‌شهری — برای bonus cityUsers
      const cityUsers = user?.city
        ? await this.userRepo.count({ where: { city: user.city } })
        : 0;

      // ادغام همه metrics در یک object
      const baseMetrics = {
        matches7d: raw7d.matches7d ?? 0,
        messages7d: raw7d.messages7d ?? extraMetrics.messages7d ?? 0,
        views7d: raw7d.views7d ?? extraMetrics.views7d ?? 0,
        likes7d: raw7d.likes7d ?? 0,
        boostUsed7d: raw7d.boostUsed7d ?? extraMetrics.boostUsed7d ?? 0,
        retentionDays: extraMetrics.retentionDays ?? 0, // FIX: از buildExtraMetrics
        pastPayments: extraMetrics.pastPayments ?? 0, // FIX: از buildExtraMetrics
        cityUsers, // FIX: محاسبه واقعی
      };

      const [weights, learningScore, profileCompleteness, sentimentScore] =
        await Promise.all([
          this.getAllWeights(),
          this.calculateLearningScore(userId),
          this.getProfileCompleteness(userId),
          this.getSentimentScore(userId),
        ]);

      const qualityMultiplier = this.calculateQualityMultiplier(baseMetrics);
      const effectiveMatches =
        baseMetrics.matches7d * qualityMultiplier.likeQuality;
      const effectiveMessages =
        baseMetrics.messages7d * qualityMultiplier.messageQuality;

      const score =
        effectiveMatches * weights.matches +
        effectiveMessages * weights.messages +
        baseMetrics.views7d * weights.views +
        baseMetrics.retentionDays * weights.retentionDays +
        baseMetrics.boostUsed7d * weights.boostUsed +
        (baseMetrics.cityUsers > 100 ? weights.cityUsers : 0) +
        (learningScore / 100) * weights.learningScore +
        profileCompleteness * weights.profileCompleteness +
        sentimentScore * weights.sentimentScore;

      const safeScore = isNaN(score) || !isFinite(score) ? 10 : score;

      let phase: string;
      if (safeScore >= 40) phase = 'hot';
      else if (safeScore >= 15) phase = 'warm';
      else phase = 'cold';

      let record = await this.repo.findOne({ where: { userId } });
      if (!record) record = this.repo.create({ userId });

      record.score = safeScore;
      record.phase = phase;
      record.learningScore = learningScore ?? 0;
      record.everPaid = baseMetrics.pastPayments > 0;

      const saved = await this.repo.save(record);

      await this.featureStore.syncPhaseScore(userId, phase, safeScore);
      await this.userRepo.update(userId, { phase: phase as any });
      return saved;
    } catch (error) {
      this.logger.error(
        `Phase calculation failed for user ${userId}: ${error.message}`,
      );
      const fallback = await this.repo.findOne({ where: { userId } });
      if (!fallback) {
        return this.repo.save(
          this.repo.create({
            userId,
            phase: 'cold',
            score: 10,
            learningScore: 0,
            everPaid: false,
          }),
        );
      }
      return fallback;
    }
  }

  private calculateQualityMultiplier(metrics: any): {
    likeQuality: number;
    messageQuality: number;
  } {
    const likeQuality =
      metrics.matches7d > 0
        ? Math.min(metrics.matches7d / (metrics.likes7d || 1), 1)
        : 0.5;

    // FIX: قبلاً receivedMessages7d هرگز پر نمی‌شد → messages7d > 0 بود ولی
    // receivedMessages7d = 0 → messageQuality = 0 (اشتباه).
    // حالا: اگر داده نداریم → default 0.5
    const messageQuality =
      (metrics.receivedMessages7d ?? 0) > 0 && metrics.messages7d > 0
        ? Math.min(metrics.receivedMessages7d / metrics.messages7d, 1)
        : 0.5;

    return { likeQuality, messageQuality };
  }

  // ─── Reinforcement Learning ───────────────────────────────────────────────

  async learnFromFeedback(
    userId: number,
    event:
      | 'purchase'
      | 'match'
      | 'message'
      | 'boost_used'
      | 'churn'
      | 'profile_completed',
    context?: { amount?: number; productType?: string },
  ) {
    const rewardMap: Record<string, number> = {
      purchase: 2,
      match: 0.5,
      message: 0.3,
      boost_used: 0.4,
      churn: -1,
      profile_completed: 1.5,
    };

    const targetWeightMap: Record<string, keyof PhaseWeights> = {
      match: 'matches',
      message: 'messages',
      boost_used: 'boostUsed',
      churn: 'retentionDays',
      profile_completed: 'profileCompleteness',
    };

    if (event === 'churn') {
      const user = await this.userRepo.findOneBy({ id: userId });
      if (user) {
        const source = user.metadata?.acquisitionSource ?? 'organic';
        const currentRaw = await this.redis.get(`revenue:source:${source}`);
        const current = currentRaw ? parseFloat(currentRaw) : 1.0;
        const newWeight = Math.max(0.1, current + 0.01 * -0.5);
        await this.redis.set(`revenue:source:${source}`, newWeight.toString());
      }
    }

    const baseReward = rewardMap[event] ?? 0;
    const reward =
      context?.amount && context.amount > 100 ? baseReward * 1.5 : baseReward;
    const targetWeight = targetWeightMap[event];
    if (!targetWeight || reward === 0) return;

    const currentWeight = await this.getWeight(targetWeight);
    const learningRate = 0.01;
    const newWeight = Math.max(
      0.1,
      Math.min(10, currentWeight + learningRate * reward),
    );

    await this.setWeight(targetWeight, newWeight);

    if (['purchase', 'match', 'message', 'profile_completed'].includes(event)) {
      await this.featureStore.learnFeatureWeights(userId, event as any);
    }

    this.logger.log(
      `Weight "${targetWeight}": ${currentWeight.toFixed(2)} → ${newWeight.toFixed(2)} (${event})`,
    );

    await this.calculate(userId);
  }

  // ─── Profile Completeness ─────────────────────────────────────────────────

  private async getProfileCompleteness(userId: number): Promise<number> {
    const cacheKey = `phase:completeness:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return parseFloat(cached);

    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['userImages', 'phones'],
    });

    if (!user) return 0;

    const checks = [
      !!user.nickname,
      !!user.city,
      !!user.birth_year,
      !!user.aboutme && user.aboutme.length > 20,
      Array.isArray(user.hobbies_self) && user.hobbies_self.length > 0,
      Array.isArray(user.values_self) && user.values_self.length > 0,
      !!user.education,
      !!user.marital,
      user.isFaceVerified ?? false,
      (user.userImages?.length ?? 0) >= 2,
      user.phones?.some((p) => p.isVerified) ?? false,
    ];

    const completeness = checks.filter(Boolean).length / checks.length;
    await this.redis.set(cacheKey, completeness.toString(), 'EX', 1800);

    return completeness;
  }

  // ─── Sentiment Score ──────────────────────────────────────────────────────

  private async getSentimentScore(userId: number): Promise<number> {
    const cacheKey = `phase:sentiment:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return parseFloat(cached);

    try {
      const personality =
        await this.personalityService.analyzePersonality(userId);

      const sentimentMap: Record<string, number> = {
        positive: 1.0,
        neutral: 0.5,
        negative: 0.0,
      };

      const score = sentimentMap[personality.sentiment] ?? 0.5;
      await this.redis.set(cacheKey, score.toString(), 'EX', 3600);

      return score;
    } catch {
      return 0.5;
    }
  }

  // ─── Read API ─────────────────────────────────────────────────────────────

  async get(userId: number): Promise<UserPhase> {
    let record = await this.repo.findOne({ where: { userId } });
    if (!record) {
      record = this.repo.create({ userId });
      await this.repo.save(record);
    }
    return record;
  }

  async markEverPaid(userId: number) {
    let record = await this.repo.findOne({ where: { userId } });
    if (!record) record = this.repo.create({ userId });
    record.everPaid = true;
    return this.repo.save(record);
  }

  async getPhaseMetrics(userId: number) {
    const phase = await this.get(userId);
    return {
      phase: phase.phase,
      score: phase.score,
      learningScore: phase.learningScore,
      everPaid: phase.everPaid,
      percentile: await this.calculatePercentile(phase.score),
      nextPhaseThreshold: this.getNextPhaseThreshold(phase.phase),
      suggestedActions: this.getSuggestedActions(phase.phase, phase.everPaid),
    };
  }

  private async calculatePercentile(score: number): Promise<number> {
    const total = await this.repo.count();
    if (total === 0) return 0;
    const less = await this.repo.count({
      where: { score: LessThan(Math.max(score, 0)) },
    });
    return Math.round((less / total) * 100);
  }

  private getNextPhaseThreshold(currentPhase: string): number {
    return currentPhase === 'cold' ? 15 : currentPhase === 'warm' ? 40 : 0;
  }

  private getSuggestedActions(phase: string, everPaid: boolean): string[] {
    const actions: string[] = [];
    switch (phase) {
      case 'cold':
        actions.push(
          'پروفایل خود را کامل کنید',
          'از بوست رایگان استفاده کنید',
          'عکس پروفایل باکیفیت آپلود کنید',
        );
        break;
      case 'warm':
        actions.push('برای شروع گفتگو اعتبار بخرید', 'با بوست بیشتر دیده شوید');
        if (!everPaid) actions.push('اولین خرید با تخفیف ویژه');
        break;
      case 'hot':
        actions.push(
          'VIP شوید و لایک نامحدود داشته باشید',
          'سوپرلایک روزانه رایگان',
        );
        break;
    }
    return actions;
  }

  async getPhaseDistribution() {
    const total = await this.repo.count();
    if (total === 0) return { cold: 0, warm: 0, hot: 0 };

    const [cold, warm, hot] = await Promise.all([
      this.repo.count({ where: { phase: 'cold' } }),
      this.repo.count({ where: { phase: 'warm' } }),
      this.repo.count({ where: { phase: 'hot' } }),
    ]);

    return {
      cold: Math.round((cold / total) * 100),
      warm: Math.round((warm / total) * 100),
      hot: Math.round((hot / total) * 100),
    };
  }
}
