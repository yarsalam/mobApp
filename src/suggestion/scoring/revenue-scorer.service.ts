import { Injectable, Logger, Inject } from '@nestjs/common';
import { FeatureStoreService } from '../../feature-store/feature-store.service';
import { UserFeatureSnapshot } from 'src/feature-store/entities/user-feature.entity';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from 'src/redis/redis.constants';

export interface RevenueScore {
  userId: number;
  candidateId: number;

  /**
   * compatibilityScore:
   * امتیاز اصلی رابطه/پیشنهاد.
   *
   * Revenue دیگر صاحب این عدد نیست.
   */
  compatibilityScore: number;

  /**
   * expectedRevenue:
   * فقط Business / Monetization signal.
   */
  expectedRevenue: number;

  /**
   * decisionScore:
   * امتیاز نهایی قبل از MMR.
   */
  decisionScore: number;

  components: {
    preferenceFit: number;
    profileFit: number;
    personalityFit: number;
    behaviorFit: number;
    geoFit: number;

    matchProbability: number;
    responseProbability: number;
    trustScore: number;

    purchaseProbability: number;
    phaseScore: number;
    phaseMultiplier: number;

    ltv: number;

    businessSignal: number;
  };

  confidence: number;
}

const FALLBACK_SNAPSHOT: Partial<UserFeatureSnapshot> = {
  profileVector: [],
  preferenceVector: [],
  positivePreferenceVector: [],
  negativePreferenceVector: [],
  behaviorVector: [],
  personalityVector: [],
  geoVector: [],

  responseProbability: 0.3,
  purchaseProbability: 0.1,
  matchProbability: 0.2,

  avgLTV: 0,
  phase: 'cold',
  phaseScore: 0,
  trustScore: 50,
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

    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  /**
   * امتیازدهی Batch به کل candidate pool.
   *
   * اینجا Intelligence اصلی پیشنهاد ساخته می‌شود.
   */
  async scoreBatch(
    userId: number,
    candidateIds: number[],
  ): Promise<RevenueScore[]> {
    if (candidateIds.length === 0) {
      return [];
    }

    const userIdNum = Number(userId);

    const ids = [
      ...new Set(candidateIds.map(Number).filter((id) => Number.isFinite(id))),
    ];

    const allFeatures = await this.featureStore.getBatchFeatures([
      userIdNum,
      ...ids,
    ]);

    const featuresMap = new Map<number, UserFeatureSnapshot>();

    for (const [key, value] of allFeatures.entries()) {
      const id = Number(key);

      if (Number.isFinite(id)) {
        featuresMap.set(id, value);
      }
    }

    const userFeatures =
      featuresMap.get(userIdNum) ?? (FALLBACK_SNAPSHOT as UserFeatureSnapshot);

    if (!featuresMap.has(userIdNum)) {
      this.logger.warn(
        `No feature snapshot for user ${userIdNum}, using fallback`,
      );
    }

    const scores: RevenueScore[] = [];

    for (const candidateId of ids) {
      const candidateFeatures =
        featuresMap.get(candidateId) ??
        (FALLBACK_SNAPSHOT as UserFeatureSnapshot);

      const score = await this.calculateScore(
        userFeatures,
        candidateFeatures,
        userIdNum,
        candidateId,
      );

      scores.push({
        userId: userIdNum,
        candidateId,
        ...score,
      });
    }

    return scores.sort((a, b) => b.decisionScore - a.decisionScore);
  }

  /**
   * Intelligence score.
   *
   * وزن‌ها عمداً طوری هستند که:
   *
   * compatibility > behavior/personality
   * > trust/response/match
   * > business
   *
   * بنابراین کاربر پول‌ساز صرفاً به خاطر پول
   * بالاتر از candidate مناسب قرار نمی‌گیرد.
   */
  private async calculateScore(
    user: UserFeatureSnapshot,
    candidate: UserFeatureSnapshot,
    userId: number,
    candidateId: number,
  ): Promise<Omit<RevenueScore, 'userId' | 'candidateId'>> {
    const userProfile = this.vector(user.profileVector, 10);

    const candidateProfile = this.vector(candidate.profileVector, 10);

    const userPreference = this.vector(
      user.preferenceVector?.length ? user.preferenceVector : userProfile,
      10,
    );

    const candidatePreference = this.vector(
      candidate.preferenceVector?.length
        ? candidate.preferenceVector
        : candidateProfile,
      10,
    );

    const userBehavior = this.vector(user.behaviorVector, 5);

    const candidateBehavior = this.vector(candidate.behaviorVector, 5);

    const userPersonality = this.vector(user.personalityVector, 5);

    const candidatePersonality = this.vector(candidate.personalityVector, 5);

    const userGeo = this.vector(user.geoVector, 2);

    const candidateGeo = this.vector(candidate.geoVector, 2);

    // ─────────────────────────────────────────────
    // Compatibility
    // ─────────────────────────────────────────────

    const preferenceFit = this.cosineSimilarity(
      userPreference,
      candidateProfile,
    );

    const reversePreferenceFit = this.cosineSimilarity(
      candidatePreference,
      userProfile,
    );

    // preference دوطرفه مهم‌تر از profile similarity است.
    const mutualPreferenceFit =
      preferenceFit * 0.7 + reversePreferenceFit * 0.3;

    const profileFit = this.cosineSimilarity(userProfile, candidateProfile);

    const personalityFit = this.cosineSimilarity(
      userPersonality,
      candidatePersonality,
    );

    const behaviorFit = this.cosineSimilarity(userBehavior, candidateBehavior);

    const geoFit = this.calculateGeoFit(userGeo, candidateGeo);

    // ─────────────────────────────────────────────
    // Learned probabilities
    // ─────────────────────────────────────────────

    const matchProbability = this.clamp01(candidate.matchProbability ?? 0.2);

    const responseProbability = this.clamp01(
      candidate.responseProbability ?? 0.3,
    );

    const trustScore = this.clamp(candidate.trustScore ?? 50, 0, 100) / 100;

    const purchaseProbability = this.clamp01(
      candidate.purchaseProbability ?? 0.1,
    );

    const phaseScore = this.clamp01(candidate.phaseScore ?? 0);

    // ─────────────────────────────────────────────
    // Phase relation
    // ─────────────────────────────────────────────

    const phaseMultiplier = await this.getPhaseMultiplier(
      user.phase ?? 'cold',
      candidate.phase ?? 'cold',
    );

    const normalizedPhaseMultiplier = this.clamp(phaseMultiplier / 1.2, 0, 1);

    // ─────────────────────────────────────────────
    // Core compatibility
    // ─────────────────────────────────────────────

    const compatibilityScore = this.clamp01(
      mutualPreferenceFit * 0.3 +
        profileFit * 0.12 +
        personalityFit * 0.15 +
        behaviorFit * 0.08 +
        geoFit * 0.05 +
        matchProbability * 0.12 +
        responseProbability * 0.08 +
        trustScore * 0.07 +
        normalizedPhaseMultiplier * 0.03,
    );

    // ─────────────────────────────────────────────
    // Business signal
    // ─────────────────────────────────────────────

    const ltv = Math.max(0, candidate.avgLTV ?? 0);

    const normalizedLtv = this.normalizeLtv(ltv);

    const businessSignal = this.clamp01(
      purchaseProbability * 0.45 +
        normalizedLtv * 0.35 +
        responseProbability * 0.2,
    );

    /**
     * Revenue واقعی:
     * فقط برای analytics / business optimization.
     */
    const expectedRevenue = Math.max(
      0,
      matchProbability * responseProbability * purchaseProbability * ltv,
    );

    /**
     * Decision score:
     *
     * 90% intelligence
     * 10% business
     */
    const decisionScore = this.clamp01(
      compatibilityScore * 0.9 + businessSignal * 0.1,
    );

    const confidence = this.calculateConfidence(user, candidate);

    return {
      compatibilityScore,
      expectedRevenue,
      decisionScore,

      components: {
        preferenceFit: mutualPreferenceFit,

        profileFit,

        personalityFit,

        behaviorFit,

        geoFit,

        matchProbability,

        responseProbability,

        trustScore,

        purchaseProbability,

        phaseScore,

        phaseMultiplier,

        ltv,

        businessSignal,
      },

      confidence,
    };
  }

  /**
   * برای جلوگیری از scale متفاوت LTV.
   *
   * اینجا logarithmic normalization استفاده می‌کنیم
   * تا یک LTV بسیار بزرگ کل ranking را منفجر نکند.
   */
  private normalizeLtv(ltv: number): number {
    if (!Number.isFinite(ltv) || ltv <= 0) {
      return 0;
    }

    return this.clamp01(Math.log1p(ltv) / Math.log1p(1000));
  }

  /**
   * Geo similarity.
   *
   * برخلاف cosine روی lat/lng،
   * اینجا فاصله absolute بهتر معنی می‌دهد.
   */
  private calculateGeoFit(a: number[], b: number[]): number {
    if (a.length !== 2 || b.length !== 2) {
      return 0.5;
    }

    const latDiff = Math.abs(a[0] - b[0]);

    const lngDiff = Math.abs(a[1] - b[1]);

    const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);

    return this.clamp01(1 - distance / 2.828);
  }

  private calculateConfidence(
    user: UserFeatureSnapshot,
    candidate: UserFeatureSnapshot,
  ): number {
    let confidence = 0;

    if (
      user.profileVector?.length === 10 &&
      candidate.profileVector?.length === 10
    ) {
      confidence += 0.2;
    }

    if (
      user.preferenceVector?.length === 10 &&
      candidate.preferenceVector?.length === 10
    ) {
      confidence += 0.25;
    }

    if (
      user.behaviorVector?.length === 5 &&
      candidate.behaviorVector?.length === 5
    ) {
      confidence += 0.15;
    }

    if (
      user.personalityVector?.length === 5 &&
      candidate.personalityVector?.length === 5
    ) {
      confidence += 0.15;
    }

    if (user.geoVector?.length === 2 && candidate.geoVector?.length === 2) {
      confidence += 0.05;
    }

    if ((candidate.matchProbability ?? 0) > 0) {
      confidence += 0.1;
    }

    if ((candidate.responseProbability ?? 0) > 0) {
      confidence += 0.1;
    }

    return this.clamp01(confidence);
  }

  private vector(value: number[] | undefined, dimension: number): number[] {
    const result = (value ?? [])
      .slice(0, dimension)
      .map((v) => (Number.isFinite(v) ? v : 0));

    while (result.length < dimension) {
      result.push(0);
    }

    return result;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || !b.length) {
      return 0.5;
    }

    const len = Math.min(a.length, b.length);

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < len; i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;

      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);

    if (!denominator) {
      return 0.5;
    }

    return this.clamp01(dot / denominator);
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  }

  private async getPhaseMultiplier(
    userPhase: string,
    candidatePhase: string,
  ): Promise<number> {
    const key = `${userPhase}_${candidatePhase}`;

    const redisKey = `revenue:phase:${key}`;

    const stored = await this.redis.get(redisKey);

    if (stored) {
      const parsed = Number.parseFloat(stored);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    const defaultValue = this.DEFAULT_PHASE_MULTIPLIERS[key] ?? 0.8;

    await this.redis.set(redisKey, defaultValue.toString());

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
      `Phase multiplier "${key}": ` +
        `${current.toFixed(3)} → ` +
        `${newValue.toFixed(3)} ` +
        `(reward: ${reward})`,
    );
  }
}
