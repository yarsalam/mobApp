import { Injectable, Logger, Inject } from '@nestjs/common';
import { FeatureStoreService } from '../../feature-store/feature-store.service';
import { UserFeatureSnapshot } from 'src/feature-store/entities/user-feature.entity';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from 'src/redis/redis.constants';

export interface RevenueScore {
  userId: number;
  candidateId: number;
  expectedRevenue: number;
  components: {
    matchProb: number;
    responseProb: number;
    purchaseProb: number;
    ltv: number;
  };
  confidence: number;
}

// وقتی feature snapshot نداریم، از این مقادیر پیش‌فرض استفاده می‌کنیم
const FALLBACK_SNAPSHOT: Partial<UserFeatureSnapshot> = {
  profileVector: [],
  preferenceVector: [],
  behaviorVector: [],
  personalityVector: [],
  responseProbability: 0.3,
  purchaseProbability: 0.1,
  matchProbability: 0.2,
  avgLTV: 0,
  phase: 'cold',
};

@Injectable()
export class RevenueScorerService {
  private readonly logger = new Logger(RevenueScorerService.name);

  private readonly DEFAULT_PHASE_MULTIPLIERS: Record<string, number> = {
    cold_cold: 0.8,
    cold_warm: 0.9,
    cold_hot: 1.0,
    warm_cold: 0.7,
    warm_warm: 1.0,
    warm_hot: 1.1,
    hot_cold: 0.6,
    hot_warm: 1.0,
    hot_hot: 1.2,
  };

  constructor(
    private readonly featureStore: FeatureStoreService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async scoreBatch(
    userId: number,
    candidateIds: number[],
  ): Promise<RevenueScore[]> {
    if (candidateIds.length === 0) return [];

    const userIdNum = Number(userId);
    const candidateIdsNum = candidateIds.map((id) => Number(id));

    const allFeatures = await this.featureStore.getBatchFeatures([
      userIdNum,
      ...candidateIdsNum,
    ]);

    const featuresMap = new Map<number, UserFeatureSnapshot>();
    for (const [key, value] of allFeatures.entries()) {
      const numKey = Number(key);
      if (!isNaN(numKey)) featuresMap.set(numKey, value);
    }

    // ← Fix: اگه user feature نداشت با fallback ادامه بده (نه return [])
    const userFeatures =
      featuresMap.get(userIdNum) ?? (FALLBACK_SNAPSHOT as UserFeatureSnapshot);

    if (!featuresMap.has(userIdNum)) {
      this.logger.warn(
        `No feature snapshot for user ${userIdNum}, using fallback`,
      );
    }

    const scores: RevenueScore[] = [];

    for (const candidateId of candidateIdsNum) {
      // ← Fix: candidate هم اگه نداشت fallback بده
      const candidateFeatures =
        featuresMap.get(candidateId) ??
        (FALLBACK_SNAPSHOT as UserFeatureSnapshot);

      const matchProb = await this.calculateMatchProbability(
        userFeatures,
        candidateFeatures,
      );
      const responseProb = this.calculateResponseProbability(candidateFeatures);
      const purchaseProb = this.calculatePurchaseProbability(candidateFeatures);
      const ltv = candidateFeatures.avgLTV ?? 0;

      // وقتی ltv=0، از matchProb استفاده می‌کنیم تا score صفر نشه
      const expectedRevenue =
        ltv > 0
          ? matchProb * responseProb * purchaseProb * ltv
          : matchProb * responseProb;

      const confidence = this.calculateConfidence(
        userFeatures,
        candidateFeatures,
      );

      scores.push({
        userId: userIdNum,
        candidateId,
        expectedRevenue,
        components: { matchProb, responseProb, purchaseProb, ltv },
        confidence,
      });
    }

    return scores.sort((a, b) => b.expectedRevenue - a.expectedRevenue);
  }

  private async calculateMatchProbability(
    user: UserFeatureSnapshot,
    candidate: UserFeatureSnapshot,
  ): Promise<number> {
    const similarity = this.cosineSimilarity(
      user.preferenceVector?.length
        ? user.preferenceVector
        : (user.profileVector ?? []),
      candidate.profileVector ?? [],
    );
    const phaseMultiplier = await this.getPhaseMultiplier(
      user.phase ?? 'cold',
      candidate.phase ?? 'cold',
    );
    return Math.max(0.1, similarity * phaseMultiplier); // حداقل 0.1
  }

  private calculateResponseProbability(candidate: UserFeatureSnapshot): number {
    return candidate.responseProbability || 0.3;
  }

  private calculatePurchaseProbability(candidate: UserFeatureSnapshot): number {
    return candidate.purchaseProbability || 0.1;
  }

  private calculateConfidence(
    user: UserFeatureSnapshot,
    candidate: UserFeatureSnapshot,
  ): number {
    let confidence = 0.8;
    if (!user.profileVector?.length || !candidate.profileVector?.length)
      confidence -= 0.2;
    if (!user.behaviorVector?.length || !candidate.behaviorVector?.length)
      confidence -= 0.1;
    if (!user.personalityVector?.length) confidence -= 0.1;
    return Math.max(0.4, confidence);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a?.length || !b?.length) return 0.5;
    const len = Math.min(a.length, b.length);
    let dot = 0,
      normA = 0,
      normB = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom ? dot / denom : 0.5;
  }

  private async getPhaseMultiplier(
    userPhase: string,
    candidatePhase: string,
  ): Promise<number> {
    const key = `${userPhase}_${candidatePhase}`;
    const stored = await this.redis.get(`revenue:phase:${key}`);
    if (stored) return parseFloat(stored);
    const defaultValue = this.DEFAULT_PHASE_MULTIPLIERS[key] ?? 0.8;
    await this.redis.set(`revenue:phase:${key}`, defaultValue.toString());
    return defaultValue;
  }

  async adjustPhaseMultiplier(
    userPhase: string,
    candidatePhase: string,
    reward: number,
  ): Promise<void> {
    const key = `${userPhase}_${candidatePhase}`;
    const current = await this.getPhaseMultiplier(userPhase, candidatePhase);
    const learningRate = 0.005;
    const newValue = Math.max(
      0.1,
      Math.min(2.0, current + learningRate * reward),
    );
    await this.redis.set(`revenue:phase:${key}`, newValue.toString());
    this.logger.log(
      `Phase multiplier "${key}": ${current.toFixed(3)} → ${newValue.toFixed(3)} (reward: ${reward})`,
    );
  }
}
