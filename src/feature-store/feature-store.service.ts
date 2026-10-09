import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { QdrantClient } from '@qdrant/js-client-rest';
import { UserFeatureSnapshot } from './entities/user-feature.entity';
import { User } from '../users/entities/user.entity';
import { PersonalityService } from '../personality/personality.service';
import { UserMetricsService } from '../user-metrics/user-metrics.service';
import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/redis/redis.constants';
import { DataSource, EntityManager } from 'typeorm';
import { FeatureLearningReceipt } from './entities/feature-learning-receipt.entity';
import { FeatureWeightState } from './entities/feature-weight-state.entity';

import {
  CACHE_KEY_PREFIX,
  CRON_LOCK_TTL,
  DEFAULT_BEHAVIOR_WEIGHTS,
  DEFAULT_PERSONALITY_WEIGHTS,
  DEFAULT_PROFILE_WEIGHTS,
  FEATURE_CACHE_TTL,
  GEO_LAT,
  GEO_LNG,
  MAX_PREFERENCE_SIGNAL,
  PREFERENCE_DECAY,
  PREFERENCE_LEARNING_RATE,
  QDRANT_COLLECTION,
  REFRESH_CONCURRENCY,
  SEGMENT_WEIGHTS,
  VECTOR_DIMS,
} from './feature-store.constan';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QdrantPayload {
  [key: string]: unknown;
  userId: number;
  updatedAt: string;
  phase: string;
  phaseScore: number;
  gender: string;
  city: string | null;
  trustScore: number;
  responseProbability: number;
  matchProbability: number;
  purchaseProbability: number;
  boostStrength: number;
  boostActive: boolean;
  retentionDays: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class FeatureStoreService implements OnModuleInit {
  private readonly logger = new Logger(FeatureStoreService.name);

  private readonly qdrant = new QdrantClient({
    host: process.env.QDRANT_HOST ?? 'qdrant',
    port: parseInt(process.env.QDRANT_PORT ?? '6333'),
  });

  constructor(
    @InjectRepository(UserFeatureSnapshot)
    private readonly featureRepo: Repository<UserFeatureSnapshot>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,

    private readonly personalityService: PersonalityService,
    private readonly userMetricsService: UserMetricsService,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Startup ─────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.ensureQdrantCollection();
  }

  private async ensureQdrantCollection(): Promise<void> {
    try {
      const result = await this.qdrant.collectionExists(QDRANT_COLLECTION);
      const exists = Boolean(result.exists);

      if (!exists) {
        await this.qdrant.createCollection(QDRANT_COLLECTION, {
          vectors: {
            size: VECTOR_DIMS.total,
            distance: 'Cosine',
          },
          optimizers_config: {
            memmap_threshold: 20_000,
          },
          hnsw_config: {
            m: 16,
            ef_construct: 200,
          },
        });

        this.logger.log(
          `Qdrant collection "${QDRANT_COLLECTION}" created (${VECTOR_DIMS.total} dims)`,
        );
      } else {
        // Collection موجود نیز باید ایندکس‌های لازم را داشته باشد.
        const info = await this.qdrant.getCollection(QDRANT_COLLECTION);
        const vectorConfig = info.config.params.vectors;

        if (
          !vectorConfig ||
          Array.isArray(vectorConfig) ||
          !('size' in vectorConfig) ||
          vectorConfig.size !== VECTOR_DIMS.total
        ) {
          this.logger.error(
            `Qdrant collection "${QDRANT_COLLECTION}" has an incompatible vector configuration. ` +
              `Expected ${VECTOR_DIMS.total} dimensions. Do not delete production data automatically.`,
          );
          return;
        }

        this.logger.log(`Qdrant collection "${QDRANT_COLLECTION}" is ready`);
      }

      await this.createPayloadIndexes();
    } catch (error) {
      this.logger.error(
        'Failed to initialize Qdrant collection/indexes',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async createPayloadIndexes(): Promise<void> {
    const fields = [
      { name: 'userId', schema_type: 'integer' as const },
      { name: 'gender', schema_type: 'keyword' as const },
      { name: 'phase', schema_type: 'keyword' as const },
      { name: 'city', schema_type: 'keyword' as const },
      { name: 'boostActive', schema_type: 'bool' as const },
      { name: 'trustScore', schema_type: 'float' as const },
    ];

    for (const field of fields) {
      try {
        await this.qdrant.createPayloadIndex(QDRANT_COLLECTION, {
          field_name: field.name,
          field_schema: field.schema_type,
          wait: true,
        });
      } catch (error) {
        this.logger.warn(
          `Could not create/verify Qdrant payload index "${field.name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  // ─── Cache Helpers ────────────────────────────────────────────────────────

  private cacheKey(userId: number): string {
    return `${CACHE_KEY_PREFIX}:${userId}`;
  }

  async getWeightArray(
    redisKey: string,
    defaults: number[],
  ): Promise<number[]> {
    const safeDefaults = defaults.map((value) =>
      Number.isFinite(value) && value >= 0.1 && value <= 10 ? value : 1,
    );

    const state = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(FeatureWeightState);

      await manager
        .createQueryBuilder()
        .insert()
        .into(FeatureWeightState)
        .values({
          key: redisKey,
          weights: [...safeDefaults],
        })
        .orIgnore()
        .execute();

      const stored = await repo.findOne({
        where: { key: redisKey },
        lock: { mode: 'pessimistic_write' },
      });

      if (!stored) {
        throw new Error(`Could not initialize feature weights: ${redisKey}`);
      }

      if (
        stored.weights.length !== safeDefaults.length ||
        !stored.weights.every(
          (value) => Number.isFinite(value) && value >= 0.1 && value <= 10,
        )
      ) {
        throw new Error(`Invalid persisted feature weights: ${redisKey}`);
      }

      return stored;
    });

    // شکست Redis نباید مقدار پایدار دیتابیس را خراب کند.
    // اما خطا را پنهان نمی‌کنیم تا مشکل زیرساختی قابل مشاهده باشد.
    await this.redis.set(
      redisKey,
      JSON.stringify(state.weights),
      'EX',
      FEATURE_CACHE_TTL,
    );

    return [...state.weights];
  }

  // ─── Public Read API ──────────────────────────────────────────────────────

  async getUserFeatures(userId: number): Promise<UserFeatureSnapshot> {
    const key = this.cacheKey(userId);
    const cached = await this.redis.get(key);

    if (cached) {
      try {
        const parsed: unknown = JSON.parse(cached);

        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'userId' in parsed &&
          (parsed as { userId: unknown }).userId === userId
        ) {
          const candidate = parsed as UserFeatureSnapshot;

          const validVector = (
            value: unknown,
            expectedLength: number,
          ): boolean =>
            value == null ||
            (Array.isArray(value) &&
              value.length === expectedLength &&
              value.every(
                (item) => typeof item === 'number' && Number.isFinite(item),
              ));

          const valid =
            validVector(candidate.profileVector, VECTOR_DIMS.profile) &&
            validVector(candidate.preferenceVector, VECTOR_DIMS.preference) &&
            validVector(
              candidate.positivePreferenceVector,
              VECTOR_DIMS.preference,
            ) &&
            validVector(
              candidate.negativePreferenceVector,
              VECTOR_DIMS.preference,
            ) &&
            validVector(candidate.behaviorVector, VECTOR_DIMS.behavior) &&
            validVector(candidate.personalityVector, VECTOR_DIMS.personality) &&
            validVector(candidate.geoVector, VECTOR_DIMS.geo);

          if (valid) {
            return candidate;
          }
        }

        this.logger.warn(
          `Invalid cached feature snapshot for user ${userId}; reloading from database`,
        );
      } catch {
        this.logger.warn(
          `Malformed cached feature snapshot for user ${userId}; reloading from database`,
        );
      }

      await this.redis.del(key);
    }

    const features = await this.featureRepo.findOne({
      where: { userId },
    });

    if (!features) {
      throw new Error(`Feature snapshot not found for user ${userId}`);
    }

    await this.redis.set(
      key,
      JSON.stringify(features),
      'EX',
      FEATURE_CACHE_TTL,
    );

    return features;
  }

  async getBatchFeatures(
    userIds: number[],
  ): Promise<Map<number, UserFeatureSnapshot>> {
    const features = await this.featureRepo.find({
      where: { userId: In(userIds) },
    });
    const map = new Map<number, UserFeatureSnapshot>();
    features.forEach((f) => map.set(f.userId, f));
    return map;
  }

  async getProfileVector(userId: number): Promise<number[] | null> {
    const features = await this.getUserFeatures(userId);
    return features?.profileVector ?? null;
  }

  async getPreferenceVector(userId: number): Promise<number[] | null> {
    const features = await this.getUserFeatures(userId);
    // preferenceVector را برگردان، اگر نبود از profileVector استفاده کن
    return features?.preferenceVector ?? features?.profileVector ?? null;
  }

  // ─── Vector Building ──────────────────────────────────────────────────────

  /**
   * ساخت بردار ترکیبی 32 بُعدی برای Qdrant.
   *
   * ترتیب: [profile(10) | preference(10) | behavior(5) | personality(5) | geo(2)]
   *
   * مهم: preferenceVector اینجا وارد Retrieval می‌شود.
   * بدون این، یادگیری از رفتار کاربر در جستجو اثری ندارد.
   */

  buildMergedVector(
    profileVector: number[],
    preferenceVector: number[],
    behaviorVector: number[],
    personalityVector: number[],
    geoVector: number[],
  ): number[] {
    const normalizeSegment = (
      vector: number[] | null | undefined,
      expectedLength: number,
      segmentName: string,
    ): number[] => {
      if (!Array.isArray(vector) || vector.length !== expectedLength) {
        throw new Error(
          `Invalid ${segmentName} vector: expected ${expectedLength} dimensions, ` +
            `received ${Array.isArray(vector) ? vector.length : 'non-array'}`,
        );
      }

      return vector.map((value) => (Number.isFinite(value) ? value : 0));
    };

    const profile = normalizeSegment(
      profileVector,
      VECTOR_DIMS.profile,
      'profile',
    );
    const preference = normalizeSegment(
      preferenceVector,
      VECTOR_DIMS.preference,
      'preference',
    );
    const behavior = normalizeSegment(
      behaviorVector,
      VECTOR_DIMS.behavior,
      'behavior',
    );
    const personality = normalizeSegment(
      personalityVector,
      VECTOR_DIMS.personality,
      'personality',
    );
    const geo = normalizeSegment(geoVector, VECTOR_DIMS.geo, 'geo');

    const merged = [
      ...profile.map((value) => value * SEGMENT_WEIGHTS.profile),
      ...preference.map((value) => value * SEGMENT_WEIGHTS.preference),
      ...behavior.map((value) => value * SEGMENT_WEIGHTS.behavior),
      ...personality.map((value) => value * SEGMENT_WEIGHTS.personality),
      ...geo.map((value) => value * SEGMENT_WEIGHTS.geo),
    ];

    if (merged.length !== VECTOR_DIMS.total) {
      throw new Error(
        `Invalid merged vector size: expected ${VECTOR_DIMS.total}, got ${merged.length}`,
      );
    }

    const norm = Math.sqrt(
      merged.reduce((sum, value) => sum + value * value, 0),
    );

    if (!Number.isFinite(norm)) {
      throw new Error('Merged vector has an invalid norm');
    }

    const normalized = merged.map((value) => value / (norm || 1));

    if (!normalized.every(Number.isFinite)) {
      throw new Error('Merged vector contains non-finite values');
    }

    return normalized;
  }

  // ─── Qdrant Write ─────────────────────────────────────────────────────────

  async upsertToQdrant(
    userId: number,
    vectors: {
      profile: number[];
      preference: number[];
      behavior: number[];
      personality: number[];
      geo: number[];
    },
    snapshot: Partial<UserFeatureSnapshot>,
    user: Partial<User>,
  ): Promise<void> {
    const mergedVector = this.buildMergedVector(
      vectors.profile,
      vectors.preference,
      vectors.behavior,
      vectors.personality,
      vectors.geo,
    );

    if (
      mergedVector.length !== VECTOR_DIMS.total ||
      !mergedVector.every(Number.isFinite)
    ) {
      throw new Error(`Refusing to upsert invalid vector for user ${userId}`);
    }

    const boostActive =
      !!user.boost?.expiresAt && new Date(user.boost.expiresAt) > new Date();

    const payload: QdrantPayload = {
      userId,
      updatedAt: new Date().toISOString(),
      phase: user.phase ?? 'cold',
      phaseScore: (snapshot.phaseScore as number) ?? 0,
      gender: user.gender ?? '',
      city: user.city ?? null,
      trustScore: snapshot.trustScore ?? user.trustScore ?? 50,
      responseProbability: snapshot.responseProbability ?? 0,
      matchProbability: snapshot.matchProbability ?? 0,
      purchaseProbability: snapshot.purchaseProbability ?? 0,
      boostStrength: user.boost?.strength ?? 0,
      boostActive,
      retentionDays: snapshot.retentionDays ?? 0,
    };

    await this.qdrant.upsert(QDRANT_COLLECTION, {
      wait: true,
      points: [{ id: userId, vector: mergedVector, payload }],
    });

    this.logger.debug(`Qdrant upserted for user ${userId}`);
  }

  // ─── Cron: Batch Refresh ──────────────────────────────────────────────────

  /**
   * هر 35 دقیقه یک‌بار، کاربران فعال را refresh می‌کند.
   * برای مقیاس بزرگ‌تر باید به BullMQ event-driven تبدیل شود.
   *
   * TODO: وقتی کاربران > 10K شدند، Cron را حذف کن
   *       و به جای آن از refreshSingle (event-driven) استفاده کن.
   */
  @Cron('*/35 * * * *')
  async refreshAllFeatures(): Promise<void> {
    const lockKey = 'lock:refresh_features';
    const locked = await this.redis.set(
      lockKey,
      '1',
      'EX',
      CRON_LOCK_TTL,
      'NX',
    );
    if (!locked) {
      this.logger.warn('Refresh already running, skipping this cycle');
      return;
    }

    try {
      this.logger.log('Refreshing feature store...');
      const cutoff = new Date(Date.now() - 35 * 60 * 1000);
      const activeUserRecords = await this.userRepo.find({
        where: {
          status: 'active',
          lastActive: MoreThan(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
        },
        select: ['id'],
        order: { updatedAt: 'ASC' },
        take: 1000,
      });
      const activeUsers = activeUserRecords.map((u) => u.id);

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < activeUsers.length; i += REFRESH_CONCURRENCY) {
        const batch = activeUsers.slice(i, i + REFRESH_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((id) => this.refreshSingle(id)),
        );
        results.forEach((r) => {
          if (r.status === 'fulfilled') successCount++;
          else failCount++;
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      this.logger.log(
        `Feature refresh done: ${successCount} ok, ${failCount} failed`,
      );
    } finally {
      await this.redis.del(lockKey);
    }
  }

  /**
   * Refresh یک کاربر مشخص.
   * این متد از Cron و از Event-driven handler هر دو صدا زده می‌شود.
   */

  async refreshSingle(userId: number): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['boost'],
    });

    if (!user) {
      this.logger.warn(`User ${userId} not found, skipping refresh`);
      return;
    }

    const [personality, metrics, existing] = await Promise.all([
      this.personalityService.analyzePersonality(userId).catch((error) => {
        this.logger.warn(
          `Personality analysis failed for user ${userId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );

        return {
          ocean: {},
          sentiment: 'neutral',
          emotion: 'neutral',
        };
      }),

      this.userMetricsService
        .getUserIntelligenceMetrics(userId)
        .catch((error) => {
          this.logger.warn(
            `Metrics lookup failed for user ${userId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );

          return {
            totalEvents: 0,
            activeDays: 0,
            likes: 0,
            matches: 0,
            messagesSent: 0,
            messagesReceived: 0,
            replies: 0,
            purchases: 0,
            totalPaidTransactions: 0,
            retentionDays: 0,
            purchaseRate: 0,
            responseRate: 0,
            matchRate: 0,
            revenueScore: 0,
          };
        }),

      this.featureRepo.findOne({ where: { userId } }),
    ]);

    const profileVector = await this.encodeProfile(user);
    const behaviorVector = await this.encodeBehavior(metrics);
    const personalityVector = await this.encodePersonality(personality);
    const geoVector = this.encodeGeo(user);

    // حفظ ترجیحات آموخته‌شده؛ refresh نباید یادگیری قبلی را پاک کند.
    const positivePreferenceVector =
      existing?.positivePreferenceVector?.length === VECTOR_DIMS.preference
        ? [...existing.positivePreferenceVector]
        : existing?.preferenceVector?.length === VECTOR_DIMS.preference
          ? [...existing.preferenceVector]
          : [...profileVector];

    const negativePreferenceVector =
      existing?.negativePreferenceVector?.length === VECTOR_DIMS.preference
        ? [...existing.negativePreferenceVector]
        : new Array(VECTOR_DIMS.preference).fill(0);

    const preferenceVector = this.buildPreferenceVector(
      positivePreferenceVector,
      negativePreferenceVector,
    );

    const snapshot: Partial<UserFeatureSnapshot> = {
      userId,
      profileVector,
      preferenceVector,
      positivePreferenceVector,
      negativePreferenceVector,

      positivePreferenceCount: Math.max(
        0,
        existing?.positivePreferenceCount ?? 0,
      ),
      negativePreferenceCount: Math.max(
        0,
        existing?.negativePreferenceCount ?? 0,
      ),

      behaviorVector,
      personalityVector,
      geoVector,

      // revenueScore معادل LTV پولی نیست؛ avgLTV قبلی را حفظ می‌کنیم.
      avgLTV: existing?.avgLTV ?? 0,

      purchaseProbability: metrics.purchaseRate,
      responseProbability: metrics.responseRate,
      matchProbability: metrics.matchRate,

      phase: user.phase ?? 'cold',
      phaseScore: existing?.phaseScore ?? 0,

      boostStrength: user.boost?.strength ?? 0,
      boostExpiresAt: user.boost?.expiresAt,

      trustScore: user.trustScore ?? 50,
      retentionDays: metrics.retentionDays,

      lastSeenAt: (user as any).lastSeenAt ?? null,
    };

    // اول snapshot پایدار می‌شود، سپس کش و Qdrant به‌روزرسانی می‌شوند.
    await this.featureRepo.save(this.featureRepo.create(snapshot));

    await this.redis.del(this.cacheKey(userId));

    await this.upsertToQdrant(
      userId,
      {
        profile: profileVector,
        preference: preferenceVector,
        behavior: behaviorVector,
        personality: personalityVector,
        geo: geoVector,
      },
      snapshot,
      user,
    );

    this.logger.debug(
      `Feature snapshot refreshed for user ${userId}; ` +
        `events=${metrics.totalEvents}, ` +
        `activeDays=${metrics.activeDays}, ` +
        `matchRate=${metrics.matchRate.toFixed(3)}`,
    );
  }

  // ─── Preference Learning ──────────────────────────────────────────────────

  /**
   * Confidence بر اساس تعداد سیگنال‌های قبلی.
   *
   * ایده:
   * - یک رفتار منفرد نباید بیش از حد تعیین‌کننده باشد.
   * - با تکرار رفتار، اعتماد مدل افزایش پیدا می‌کند.
   * - اشباع تدریجی داریم تا بعد از تعداد زیادی event، وزن بی‌نهایت نشود.
   */
  private calculatePreferenceConfidence(signalCount: number): number {
    const safeCount = Math.max(0, signalCount);

    // saturation:
    // count=0  => 0
    // count=1  => 0.18
    // count=5  => 0.63
    // count=10 => 0.86
    // count=20 => 0.98
    const saturation = 1 - Math.exp(-safeCount / 5);

    // اجازه نمی‌دهیم اولین سیگنال بیش از حد ضعیف شود.
    return 0.55 + 0.45 * saturation;
  }

  /**
   * Confidence خام را برای APIهای تحلیلی برمی‌گرداند.
   */
  private calculateSignalConfidence(signalCount: number): number {
    const safeCount = Math.max(0, signalCount);

    return Math.min(1, Math.max(0, 1 - Math.exp(-safeCount / 5)));
  }

  /**
   * بردار preference نهایی.
   *
   * positive = چیزهایی که کاربر دوست دارد
   * negative = چیزهایی که کاربر نمی‌خواهد
   *
   * نتیجه:
   *
   * preference =
   *     positive
   *     -
   *     negative * negativeStrength
   */
  private buildPreferenceVector(
    positive: number[],
    negative: number[],
  ): number[] {
    const dims = Math.max(positive.length, negative.length);

    const result: number[] = [];

    for (let i = 0; i < dims; i++) {
      const p = positive[i] ?? 0;
      const n = negative[i] ?? 0;

      /**
       * negative signal نباید بلافاصله
       * positive preference را نابود کند.
       *
       * بنابراین مقدار آن به صورت کنترل‌شده
       * از preference کم می‌شود.
       */
      const value = p - n * 0.75;

      result.push(Math.max(0, Math.min(1, value)));
    }

    return result;
  }

  /**
   * دریافت positive preference.
   */
  async getPositivePreferenceVector(userId: number): Promise<number[]> {
    const features = await this.getUserFeatures(userId);

    if (
      features?.positivePreferenceVector &&
      features.positivePreferenceVector.length === VECTOR_DIMS.preference
    ) {
      return features.positivePreferenceVector;
    }

    // backward compatibility
    if (
      features?.preferenceVector &&
      features.preferenceVector.length === VECTOR_DIMS.preference
    ) {
      return features.preferenceVector;
    }

    return features?.profileVector ?? new Array(VECTOR_DIMS.preference).fill(0);
  }

  /**
   * دریافت negative preference.
   */
  async getNegativePreferenceVector(userId: number): Promise<number[]> {
    const features = await this.getUserFeatures(userId);

    if (
      features?.negativePreferenceVector &&
      features.negativePreferenceVector.length === VECTOR_DIMS.preference
    ) {
      return features.negativePreferenceVector;
    }

    return new Array(VECTOR_DIMS.preference).fill(0);
  }

  async learnPositivePreference(
    userId: number,
    targetProfileVector: number[],
    weight = 0.5,
    eventId?: number,
  ): Promise<void> {
    await this.learnPreferenceSignal(
      userId,
      targetProfileVector,
      Math.abs(weight),
      'positive',
      eventId,
    );
  }

  async learnNegativePreference(
    userId: number,
    targetProfileVector: number[],
    weight = 0.35,
    eventId?: number,
  ): Promise<void> {
    await this.learnPreferenceSignal(
      userId,
      targetProfileVector,
      Math.abs(weight),
      'negative',
      eventId,
    );
  }

  private async learnPreferenceSignal(
    userId: number,
    targetProfileVector: number[],
    weight: number,
    direction: 'positive' | 'negative',
    eventId?: number,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      !Array.isArray(targetProfileVector) ||
      !targetProfileVector.every(Number.isFinite) ||
      !Number.isFinite(weight) ||
      weight < 0
    ) {
      throw new Error('Invalid preference learning input');
    }

    // برای یادگیری از event، شناسهٔ پایدار الزامی است.
    if (!Number.isSafeInteger(eventId) || (eventId ?? 0) <= 0) {
      throw new Error('eventId is required for idempotent preference learning');
    }

    const dimension = VECTOR_DIMS.preference;

    const target = targetProfileVector.slice(0, dimension);
    while (target.length < dimension) target.push(0);

    const result = await this.dataSource.transaction(async (manager) => {
      const featureRepo = manager.getRepository(UserFeatureSnapshot);
      const receiptRepo = manager.getRepository(FeatureLearningReceipt);

      // قفل ردیف کاربر برای جلوگیری از lost update.
      const features = await featureRepo.findOne({
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!features) {
        throw new Error(`Feature snapshot not found for user ${userId}`);
      }

      const effectType = `preference:${direction}`;

      const previousReceipt = await receiptRepo.findOne({
        where: { eventId: eventId!, effectType },
      });

      if (previousReceipt) {
        return {
          changed: false,
          features,
        };
      }

      const positive = (
        features.positivePreferenceVector ??
        features.preferenceVector ??
        features.profileVector ??
        new Array(dimension).fill(0)
      ).slice(0, dimension);

      const negative = (
        features.negativePreferenceVector ?? new Array(dimension).fill(0)
      ).slice(0, dimension);

      while (positive.length < dimension) positive.push(0);
      while (negative.length < dimension) negative.push(0);

      const isPositive = direction === 'positive';

      const previousCount = Math.max(
        0,
        isPositive
          ? (features.positivePreferenceCount ?? 0)
          : (features.negativePreferenceCount ?? 0),
      );

      const historyMultiplier =
        this.calculatePreferenceConfidence(previousCount);

      const effectiveWeight = Math.abs(weight) * historyMultiplier;

      const learningRate = Math.min(
        PREFERENCE_LEARNING_RATE * effectiveWeight,
        MAX_PREFERENCE_SIGNAL,
      );

      const decay = Math.max(0, Math.min(1, PREFERENCE_DECAY));

      const current = isPositive ? positive : negative;

      const updated = current.map((value, index) =>
        Math.max(
          0,
          Math.min(1, value * decay + (target[index] ?? 0) * learningRate),
        ),
      );

      const updatedPositive = isPositive ? updated : positive;
      const updatedNegative = isPositive ? negative : updated;

      features.positivePreferenceVector = updatedPositive;
      features.negativePreferenceVector = updatedNegative;
      features.preferenceVector = this.buildPreferenceVector(
        updatedPositive,
        updatedNegative,
      );

      if (isPositive) {
        features.positivePreferenceCount = previousCount + 1;
      } else {
        features.negativePreferenceCount = previousCount + 1;
      }

      // ثبت تغییر و receipt در یک تراکنش دیتابیس.
      await featureRepo.save(features);
      await receiptRepo.save(
        receiptRepo.create({
          eventId: eventId!,
          effectType,
          userId,
        }),
      );

      return {
        changed: true,
        features,
      };
    });

    // Cache و Qdrant خارج از تراکنش SQL هستند؛
    // تکرار همان event هم باید فرصت repair داشته باشد.
    await this.redis.del(this.cacheKey(userId));

    const features = result.features;
    const preferenceVector =
      features.preferenceVector ??
      this.buildPreferenceVector(
        features.positivePreferenceVector ?? [],
        features.negativePreferenceVector ?? [],
      );

    await this.upsertPreferenceToQdrant(userId, preferenceVector);

    this.logger.debug(
      `Preference ${direction} event=${eventId} user=${userId} ` +
        `changed=${result.changed}`,
    );
  }

  async updatePreferenceVector(
    userId: number,
    targetProfileVector: number[],
    weight: number,
    eventId: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(eventId) || eventId <= 0) {
      throw new Error('eventId is required');
    }

    if (weight >= 0) {
      await this.learnPositivePreference(
        userId,
        targetProfileVector,
        weight,
        eventId,
      );
    } else {
      await this.learnNegativePreference(
        userId,
        targetProfileVector,
        Math.abs(weight),
        eventId,
      );
    }
  }

  /**
   * آپدیت Qdrant بعد از تغییر preference.
   */
  private async upsertPreferenceToQdrant(
    userId: number,
    newPreference: number[],
  ): Promise<void> {
    try {
      const existing = await this.featureRepo.findOne({
        where: { userId },
      });

      if (!existing) {
        return;
      }

      const profile =
        existing.profileVector ?? new Array(VECTOR_DIMS.profile).fill(0);

      const behavior =
        existing.behaviorVector ?? new Array(VECTOR_DIMS.behavior).fill(0);

      const personality =
        existing.personalityVector ??
        new Array(VECTOR_DIMS.personality).fill(0);

      const geo = existing.geoVector ?? [0, 0];

      await this.upsertToQdrant(
        userId,
        {
          profile,
          preference: newPreference,
          behavior,
          personality,
          geo,
        },
        existing,
        {
          phase: existing.phase as 'cold' | 'warm' | 'hot',

          trustScore: existing.trustScore,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to update preference in Qdrant for ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // ─── Feature Weight Learning ──────────────────────────────────────────────

  /**
   * تنظیم وزن ویژگی‌ها بر اساس رویداد.
   *
   * تفاوت با نسخه قبلی:
   * - دیگر refreshSingle صدا نمی‌زند (حلقه بی‌پایان جلوگیری می‌شود)
   * - فقط وزن‌ها در Redis آپدیت می‌شوند
   * - refresh باید توسط Cron یا Event handler بعداً انجام شود
   */

  async learnFeatureWeights(
    userId: number,
    event: 'purchase' | 'match' | 'message' | 'profile_completed' | 'block',
    eventId: number,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      !Number.isSafeInteger(eventId) ||
      eventId <= 0
    ) {
      throw new Error('Valid userId and eventId are required');
    }

    const config: Record<
      string,
      { key: string; index: number; delta: number; defaults: number[] }
    > = {
      purchase: {
        key: 'feature:weights:behavior',
        index: 2,
        delta: 0.01,
        defaults: DEFAULT_BEHAVIOR_WEIGHTS,
      },
      match: {
        key: 'feature:weights:behavior',
        index: 4,
        delta: 0.01,
        defaults: DEFAULT_BEHAVIOR_WEIGHTS,
      },
      message: {
        key: 'feature:weights:behavior',
        index: 3,
        delta: 0.01,
        defaults: DEFAULT_BEHAVIOR_WEIGHTS,
      },
      profile_completed: {
        key: 'feature:weights:profile',
        index: 5,
        delta: 0.01,
        defaults: DEFAULT_PROFILE_WEIGHTS,
      },
      block: {
        key: 'feature:weights:behavior',
        index: 3,
        delta: -0.01,
        defaults: DEFAULT_BEHAVIOR_WEIGHTS,
      },
    };

    const item = config[event];
    if (!item) return;

    await this.dataSource.transaction(async (manager) => {
      const stateRepo = manager.getRepository(FeatureWeightState);
      const receiptRepo = manager.getRepository(FeatureLearningReceipt);

      const effectType = `weight:${event}`;

      // ایجاد امن ردیف اولیه؛ برای MySQL/MariaDB.
      await manager
        .createQueryBuilder()
        .insert()
        .into(FeatureWeightState)
        .values({
          key: item.key,
          weights: [...item.defaults],
        })
        .orIgnore()
        .execute();

      // سریال‌سازی تغییرات هم‌زمان روی یک مجموعه وزن.
      const state = await stateRepo.findOne({
        where: { key: item.key },
        lock: { mode: 'pessimistic_write' },
      });

      if (!state) {
        throw new Error(`Feature weight state ${item.key} not found`);
      }

      // بررسی receipt باید پس از گرفتن قفل وزن انجام شود.
      const previousReceipt = await receiptRepo.findOne({
        where: { eventId, effectType },
      });

      if (previousReceipt) return;

      const weights = [...state.weights];

      if (
        weights.length !== item.defaults.length ||
        !weights.every(
          (value) => Number.isFinite(value) && value >= 0.1 && value <= 10,
        )
      ) {
        throw new Error(`Invalid persisted weights for ${item.key}`);
      }

      weights[item.index] = Math.max(
        0.1,
        Math.min(10, weights[item.index] + item.delta),
      );

      state.weights = weights;

      await stateRepo.save(state);

      await receiptRepo.save(
        receiptRepo.create({
          eventId,
          effectType,
          userId,
        }),
      );
    });

    // Redis فقط cache است؛ دیتابیس مرجع پایدار است.
    const state = await this.featureRepo.manager
      .getRepository(FeatureWeightState)
      .findOne({ where: { key: item.key } });

    if (state) {
      await this.redis.set(item.key, JSON.stringify(state.weights));
    }
  }

  // ─── Phase Score Sync ─────────────────────────────────────────────────────

  /**
   * آپدیت phaseScore در FeatureStore بعد از اینکه PhaseService محاسبه کرد.
   * PhaseService باید این متد را صدا بزند، نه اینکه FeatureStore مستقل محاسبه کند.
   */
  async syncPhaseScore(
    userId: number,
    phase: string,
    phaseScore: number,
  ): Promise<void> {
    await this.featureRepo.update({ userId }, { phase, phaseScore });
    await this.redis.del(this.cacheKey(userId));

    // ✅ Qdrant Payload Sync
    try {
      await this.qdrant.setPayload(QDRANT_COLLECTION, {
        payload: { phase, phaseScore },
        points: [userId],
      });
    } catch (err) {
      this.logger.error(`Failed to sync phase in Qdrant for ${userId}`, err);
    }
  }

  // ─── Encode Helpers ───────────────────────────────────────────────────────

  private async encodeProfile(user: User): Promise<number[]> {
    const weights = await this.getWeightArray(
      'feature:weights:profile',
      DEFAULT_PROFILE_WEIGHTS,
    );

    const age = this.calculateAge(user.birth_year);

    const raw = [
      user.city ? 1 : 0, // [0] city
      age / 100, // [1] age (normalize)
      Math.min((user.aboutme?.length ?? 0) / 500, 1), // [2] bio length
      Math.min((user.hobbies_self?.length ?? 0) / 10, 1), // [3] hobbies count
      Math.min((user.values_self?.length ?? 0) / 5, 1), // [4] values count
      user.isFaceVerified ? 1 : 0, // [5] face verified
      (user.trustScore ?? 50) / 100, // [6] trust score
      user.gender === 'male' ? 1 : 0, // [7] gender
      user.marital ? 1 : 0, // [8] marital status
      user.education ? 1 : 0, // [9] education
    ];

    return raw.map((v, i) => v * weights[i]);
  }

  private async encodeBehavior(events: any): Promise<number[]> {
    const weights = await this.getWeightArray(
      'feature:weights:behavior',
      DEFAULT_BEHAVIOR_WEIGHTS,
    );
    const raw = [
      Math.min((events.totalEvents ?? 0) / 1000, 1), // [0] activity volume
      Math.min((events.activeDays ?? 0) / 30, 1), // [1] retention
      events.purchaseRate ?? 0, // [2] purchase probability
      events.responseRate ?? 0, // [3] response rate
      events.matchRate ?? 0, // [4] match rate
    ];
    return raw.map((v, i) => v * weights[i]);
  }

  private async encodePersonality(personality: any): Promise<number[]> {
    const weights = await this.getWeightArray(
      'feature:weights:personality',
      DEFAULT_PERSONALITY_WEIGHTS,
    );
    const ocean = personality?.ocean ?? {};
    const raw = [
      ocean.openness ?? 0.5,
      ocean.conscientiousness ?? 0.5,
      ocean.extraversion ?? 0.5,
      ocean.agreeableness ?? 0.5,
      ocean.neuroticism ?? 0.5,
    ];
    return raw.map((v, i) => v * weights[i]);
  }

  /**
   * تبدیل lat/lng به بردار normalize شده [-1, 1].
   * محدوده ایران: lat [25, 40], lng [44, 64]
   *
   * نسخه قبلی همیشه [0,0] برمی‌گرداند — این Fix شده.
   */
  private encodeGeo(user: User): number[] {
    const lat = (user as any).latitude ?? (user as any).lat ?? null;
    const lng = (user as any).longitude ?? (user as any).lng ?? null;

    if (lat == null || lng == null) {
      return [0, 0]; // مرکز (نه گوشه) — کمترین تأثیر
    }

    const normalizedLat =
      ((lat - GEO_LAT.min) / (GEO_LAT.max - GEO_LAT.min)) * 2 - 1;
    const normalizedLng =
      ((lng - GEO_LNG.min) / (GEO_LNG.max - GEO_LNG.min)) * 2 - 1;

    return [
      Math.max(-1, Math.min(1, normalizedLat)),
      Math.max(-1, Math.min(1, normalizedLng)),
    ];
  }

  // ─── Utils ────────────────────────────────────────────────────────────────

  private calculateAge(birthYear: string | number | null | undefined): number {
    if (!birthYear) return 0;
    const year = parseInt(String(birthYear));
    if (isNaN(year)) return 0;

    // تشخیص تاریخ شمسی
    const currentYear = new Date().getFullYear();
    const age =
      year > 1300 && year < 1420
        ? currentYear - (year + 621)
        : currentYear - year;

    return Math.max(0, Math.min(100, age));
  }
}
