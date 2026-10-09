import { Injectable, Logger, Inject } from '@nestjs/common';
import { FeatureStoreService } from '../../feature-store/feature-store.service';
import { UserFeatureSnapshot } from 'src/feature-store/entities/user-feature.entity';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from 'src/redis/redis.constants';

export interface RevenueScore {
  userId: number;
  candidateId: number;
  compatibilityScore: number;
  decisionScore: number;
  expectedRevenue: number;
  components: {
    mutualPreferenceFit: number;
    profileFit: number;
    personalityFit: number;
    behaviorFit: number;
    geoFit: number;
    trustFit: number;
    matchProbability: number;
    responseProbability: number;
    purchaseProbability: number;
    phaseMultiplier: number;
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
  trustScore: 50,
};

@Injectable()
export class RevenueScorerService {
  private readonly logger = new Logger(RevenueScorerService.name);

  private readonly DEFAULT_PHASE_MULTIPLIERS: Record<string, number> = {
    cold_cold: 0.9,
    cold_warm: 0.95,
    cold_hot: 1,
    warm_cold: 0.9,
    warm_warm: 1,
    warm_hot: 1.05,
    hot_cold: 0.9,
    hot_warm: 1,
    hot_hot: 1.05,
  };

  constructor(
    private readonly featureStore: FeatureStoreService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async scoreBatch(
    userId: number,
    candidateIds: number[],
  ): Promise<RevenueScore[]> {
    const safeUserId = Number(userId);

    if (!Number.isSafeInteger(safeUserId) || safeUserId <= 0) {
      return [];
    }

    const uniqueCandidateIds = [
      ...new Set(
        (candidateIds ?? [])
          .map(Number)
          .filter(
            (id) => Number.isSafeInteger(id) && id > 0 && id !== safeUserId,
          ),
      ),
    ];

    if (uniqueCandidateIds.length === 0) return [];

    const allFeatures = await this.featureStore.getBatchFeatures([
      safeUserId,
      ...uniqueCandidateIds,
    ]);

    const featuresMap = new Map<number, UserFeatureSnapshot>();

    for (const [key, value] of allFeatures.entries()) {
      const id = Number(key);

      if (Number.isSafeInteger(id)) {
        featuresMap.set(id, value);
      }
    }

    const userFeatures =
      featuresMap.get(safeUserId) ?? (FALLBACK_SNAPSHOT as UserFeatureSnapshot);

    if (!featuresMap.has(safeUserId)) {
      this.logger.warn(
        `Missing feature snapshot for user ${safeUserId}; using fallback features`,
      );
    }

    /*
     * Cache محلی برای همین batch:
     * چند کاندید با ترکیب فاز یکسان فقط یک بار ضریب فاز را می‌خوانند.
     */
    const phaseCache = new Map<string, Promise<number>>();

    const getCachedPhaseMultiplier = (
      userPhase: string,
      candidatePhase: string,
    ): Promise<number> => {
      const key = `${userPhase}_${candidatePhase}`;

      let pending = phaseCache.get(key);

      if (!pending) {
        pending = this.getPhaseMultiplier(userPhase, candidatePhase);

        phaseCache.set(key, pending);
      }

      return pending;
    };

    const scores = await Promise.all(
      uniqueCandidateIds.map(async (candidateId): Promise<RevenueScore> => {
        const candidate =
          featuresMap.get(candidateId) ??
          (FALLBACK_SNAPSHOT as UserFeatureSnapshot);

        const userPhase = userFeatures.phase ?? 'cold';
        const candidatePhase = candidate.phase ?? 'cold';

        const [mutualPreferenceFit, phaseMultiplier] = await Promise.all([
          Promise.resolve(
            this.calculateMutualPreferenceFit(userFeatures, candidate),
          ),
          getCachedPhaseMultiplier(userPhase, candidatePhase),
        ]);

        const profileFit = this.cosine01(
          userFeatures.profileVector ?? [],
          candidate.profileVector ?? [],
        );

        const personalityFit = this.vectorAgreement(
          userFeatures.personalityVector ?? [],
          candidate.personalityVector ?? [],
        );

        const behaviorFit = this.cosine01(
          userFeatures.behaviorVector ?? [],
          candidate.behaviorVector ?? [],
        );

        const geoFit = this.calculateGeoFit(
          userFeatures.geoVector ?? [],
          candidate.geoVector ?? [],
        );

        const trustFit = this.clamp(
          this.safeNumber(candidate.trustScore, 50) / 100,
          0,
          1,
        );

        const matchProbability = this.probability(
          candidate.matchProbability,
          0.2,
        );

        const responseProbability = this.probability(
          candidate.responseProbability,
          0.3,
        );

        const purchaseProbability = this.probability(
          candidate.purchaseProbability,
          0.1,
        );

        const probabilityFit =
          matchProbability * 0.5 + responseProbability * 0.5;

        const phaseFit = this.clamp(phaseMultiplier / 1.05, 0, 1);

        const compatibilityScore = this.clamp(
          mutualPreferenceFit * 0.35 +
            profileFit * 0.15 +
            personalityFit * 0.15 +
            behaviorFit * 0.1 +
            geoFit * 0.1 +
            trustFit * 0.05 +
            probabilityFit * 0.07 +
            phaseFit * 0.03,
          0,
          1,
        );

        const ltv = Math.max(0, this.safeNumber(candidate.avgLTV, 0));

        // اگر LTV معتبر نداریم، درآمد موردانتظار را صفر نگه می‌داریم.
        // مقدار جایگزین 1 باعث ساختن سیگنال درآمد مصنوعی می‌شد.
        const expectedRevenue =
          ltv > 0
            ? matchProbability * responseProbability * purchaseProbability * ltv
            : 0;

        // درآمد فقط وقتی وارد رتبه‌بندی می‌شود که دادهٔ LTV موجود باشد.
        // log1p مانع سلطهٔ مقادیر درآمدی بسیار بزرگ بر امتیاز می‌شود.
        const businessSignal =
          ltv > 0 ? this.clamp(Math.log1p(expectedRevenue) / 10, 0, 1) : 0;

        // سازگاری رابطه‌ای همچنان عامل اصلی است.
        // درآمد حداکثر 3 درصد وزن دارد.
        const revenueWeight = ltv > 0 ? 0.03 : 0;

        const decisionScore = this.clamp(
          compatibilityScore * (1 - revenueWeight) +
            businessSignal * revenueWeight,
          0,
          1,
        );

        const confidence = this.calculateConfidence(userFeatures, candidate);

        return {
          userId: safeUserId,
          candidateId,
          compatibilityScore,
          decisionScore,
          expectedRevenue,
          components: {
            mutualPreferenceFit,
            profileFit,
            personalityFit,
            behaviorFit,
            geoFit,
            trustFit,
            matchProbability,
            responseProbability,
            purchaseProbability,
            phaseMultiplier,
            businessSignal,
          },
          confidence,
        };
      }),
    );

    return scores.sort((a, b) => b.decisionScore - a.decisionScore);
  }

  private calculateMutualPreferenceFit(
    user: UserFeatureSnapshot,
    candidate: UserFeatureSnapshot,
  ): number {
    const userPreference = user.preferenceVector?.length
      ? user.preferenceVector
      : (user.profileVector ?? []);

    const candidatePreference = candidate.preferenceVector?.length
      ? candidate.preferenceVector
      : (candidate.profileVector ?? []);

    const userLikesCandidate = this.cosine01(
      userPreference,
      candidate.profileVector ?? [],
    );

    const candidateLikesUser = this.cosine01(
      candidatePreference,
      user.profileVector ?? [],
    );

    return Math.sqrt(
      Math.max(0, userLikesCandidate) * Math.max(0, candidateLikesUser),
    );
  }

  private calculateGeoFit(a: number[], b: number[]): number {
    if (a.length < 2 || b.length < 2) return 0.5;

    const latA = this.clamp(a[0], -1, 1);
    const lngA = this.clamp(a[1], -1, 1);
    const latB = this.clamp(b[0], -1, 1);
    const lngB = this.clamp(b[1], -1, 1);

    const distance = Math.sqrt((latA - latB) ** 2 + (lngA - lngB) ** 2);

    return this.clamp(Math.exp(-distance * 1.5), 0, 1);
  }

  private vectorAgreement(a: number[], b: number[]): number {
    if (!a.length || !b.length) return 0.5;

    const length = Math.min(a.length, b.length);

    if (length === 0) return 0.5;

    let totalDifference = 0;

    for (let i = 0; i < length; i++) {
      totalDifference += Math.abs(
        this.clamp(a[i], 0, 1) - this.clamp(b[i], 0, 1),
      );
    }

    return this.clamp(1 - totalDifference / length, 0, 1);
  }

  private cosine01(a: number[], b: number[]): number {
    if (!a.length || !b.length) return 0.5;

    const length = Math.min(a.length, b.length);

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < length; i++) {
      const av = this.safeNumber(a[i], 0);
      const bv = this.safeNumber(b[i], 0);

      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);

    if (!denominator) return 0.5;

    return this.clamp((dot / denominator + 1) / 2, 0, 1);
  }

  private probability(value: unknown, fallback: number): number {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      return fallback;
    }

    return parsed;
  }

  private calculateConfidence(
    user: UserFeatureSnapshot,
    candidate: UserFeatureSnapshot,
  ): number {
    const checks = [
      [user.profileVector, candidate.profileVector],
      [user.preferenceVector, candidate.preferenceVector],
      [user.personalityVector, candidate.personalityVector],
      [user.behaviorVector, candidate.behaviorVector],
      [user.geoVector, candidate.geoVector],
    ];

    const available = checks.filter(
      ([a, b]) =>
        Array.isArray(a) &&
        Array.isArray(b) &&
        (a as number[]).length > 0 &&
        (b as number[]).length > 0,
    ).length;

    return this.clamp(0.25 + (available / checks.length) * 0.75, 0, 1);
  }

  private async getPhaseMultiplier(
    userPhase: string,
    candidatePhase: string,
  ): Promise<number> {
    const key = `${userPhase}_${candidatePhase}`;
    const redisKey = `revenue:phase:${key}`;

    try {
      const stored = await this.redis.get(redisKey);

      if (stored !== null) {
        const parsed = Number(stored);

        if (Number.isFinite(parsed)) {
          return this.clamp(parsed, 0.1, 2);
        }
      }

      const fallback = this.DEFAULT_PHASE_MULTIPLIERS[key] ?? 1;

      await this.redis.set(redisKey, String(fallback), 'EX', 86400);

      return fallback;
    } catch (error) {
      this.logger.warn(
        `Phase multiplier lookup failed for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return this.DEFAULT_PHASE_MULTIPLIERS[key] ?? 1;
    }
  }

  async adjustPhaseMultiplier(
    userPhase: string,
    candidatePhase: string,
    reward: number,
  ): Promise<void> {
    const key = `${userPhase}_${candidatePhase}`;
    const current = await this.getPhaseMultiplier(userPhase, candidatePhase);

    const safeReward = this.clamp(Number(reward) || 0, -1, 1);

    const newValue = this.clamp(current + 0.005 * safeReward, 0.1, 2);

    await this.redis.set(`revenue:phase:${key}`, String(newValue), 'EX', 86400);

    this.logger.log(
      `Phase multiplier ${key}: ${current.toFixed(3)} -> ${newValue.toFixed(3)}`,
    );
  }

  private safeNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;

    return Math.max(min, Math.min(max, value));
  }
}
