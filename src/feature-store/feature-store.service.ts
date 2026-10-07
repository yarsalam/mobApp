import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThan, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { QdrantClient } from '@qdrant/js-client-rest';
import { UserFeatureSnapshot } from './entities/user-feature.entity';
import { User } from '../users/entities/user.entity';
import { PersonalityService } from '../personality/personality.service';
import { UserEventService } from '../user-event/user-event.service';
import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/redis/redis.constants';

import {
  CACHE_KEY_PREFIX,
  CRON_LOCK_TTL,
  DEFAULT_BEHAVIOR_WEIGHTS,
  DEFAULT_PERSONALITY_WEIGHTS,
  DEFAULT_PROFILE_WEIGHTS,
  FEATURE_CACHE_TTL,
  GEO_LAT,
  GEO_LNG,
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
    private readonly userEventService: UserEventService,
  ) {}

  // ─── Startup ─────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.ensureQdrantCollection();
  }

  private async ensureQdrantCollection(): Promise<void> {
    try {
      const exists = await this.qdrant.collectionExists(QDRANT_COLLECTION);
      if (exists) {
        // اگر collection قبلاً با 22 بُعد ساخته شده، باید recreate شود
        // در production این باید با migration انجام شود
        this.logger.log(
          `Qdrant collection "${QDRANT_COLLECTION}" already exists`,
        );
        return;
      }

      await this.qdrant.createCollection(QDRANT_COLLECTION, {
        vectors: {
          size: VECTOR_DIMS.total, // 32 بُعد
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

      // ایجاد payload index برای فیلتر سریع
      await this.createPayloadIndexes();

      this.logger.log(
        `Qdrant collection "${QDRANT_COLLECTION}" created (${VECTOR_DIMS.total} dims)`,
      );
    } catch (err) {
      this.logger.error('Failed to init Qdrant collection:', err);
    }
  }

  /**
   * ایجاد Index روی payload fields که در فیلتر استفاده می‌شوند.
   * بدون این Index، فیلتر روی payload کند است.
   */
  private async createPayloadIndexes(): Promise<void> {
    const fields = [
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
        });
      } catch {
        // اگر قبلاً ساخته شده، خطا نادیده گرفته می‌شود
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
    const stored = await this.redis.get(redisKey);
    if (stored) return JSON.parse(stored);
    await this.redis.set(redisKey, JSON.stringify(defaults));
    return defaults;
  }

  // ─── Public Read API ──────────────────────────────────────────────────────

  async getUserFeatures(userId: number): Promise<UserFeatureSnapshot> {
    const cached = await this.redis.get(this.cacheKey(userId));
    if (cached) return JSON.parse(cached);

    const features = await this.featureRepo.findOne({ where: { userId } });
    if (!features) {
      throw new Error(`Feature snapshot not found for user ${userId}`);
    }

    await this.redis.set(
      this.cacheKey(userId),
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
    const merged = [
      ...profileVector.map((v) => v * SEGMENT_WEIGHTS.profile),
      ...preferenceVector.map((v) => v * SEGMENT_WEIGHTS.preference),
      ...behaviorVector.map((v) => v * SEGMENT_WEIGHTS.behavior),
      ...personalityVector.map((v) => v * SEGMENT_WEIGHTS.personality),
      ...geoVector.map((v) => v * SEGMENT_WEIGHTS.geo),
    ];

    // ✅ Normalization
    const norm = Math.sqrt(merged.reduce((s, v) => s + v * v, 0));
    return merged.map((v) => v / (norm || 1));
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

    const [personality, events, existing] = await Promise.all([
      this.personalityService.analyzePersonality(userId).catch(() => ({
        ocean: {},
        sentiment: 'neutral',
        emotion: 'neutral',
      })),
      this.userEventService.getUserStats(userId).catch(() => ({
        totalEvents: 0,
        activeDays: 0,
        avgLTV: 0,
        purchaseRate: 0,
        responseRate: 0,
        matchRate: 0,
      })),
      this.featureRepo.findOne({ where: { userId } }),
    ]);

    const profileVector = await this.encodeProfile(user);
    const behaviorVector = await this.encodeBehavior(events);
    const personalityVector = await this.encodePersonality(personality);
    const geoVector = this.encodeGeo(user);

    // preferenceVector: اگر قبلاً یادگیری اتفاق افتاده حفظ می‌شود
    // اگر نه، از profileVector شروع می‌شود
    const preferenceVector =
      existing?.preferenceVector?.length === VECTOR_DIMS.preference
        ? existing.preferenceVector
        : [...profileVector]; // کپی می‌گیریم

    const snapshot: Partial<UserFeatureSnapshot> = {
      userId,
      profileVector,
      preferenceVector,
      behaviorVector,
      personalityVector,
      geoVector,
      avgLTV: events.avgLTV ?? 0,
      purchaseProbability: events.purchaseRate ?? 0,
      responseProbability: events.responseRate ?? 0,
      matchProbability: events.matchRate ?? 0,
      phase: user.phase ?? 'cold',
      phaseScore: existing?.phaseScore ?? 0,
      boostStrength: user.boost?.strength ?? 0,
      boostExpiresAt: user.boost?.expiresAt,
      trustScore: user.trustScore ?? 50,
      retentionDays: events.activeDays ?? 0,
      lastSeenAt: (user as any).lastSeenAt ?? null,
    };

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
  }

  // ─── Preference Learning ──────────────────────────────────────────────────

  /**
   * آپدیت preferenceVector بعد از یک رویداد مثبت (like/match).
   *
   * الگوریتم: Exponential Moving Average
   *   preference = preference * decay + target * learningRate * weight
   *
   * این متد فقط preferenceVector را آپدیت می‌کند.
   * refreshSingle را صدا نمی‌زند — چون نیازی به rebuild کامل نیست.
   */
  async updatePreferenceVector(
    uid: number,
    targetProfileVec: number[],
    weight: number, // 1.0 برای match، 0.5 برای like، -1.0 برای block
  ): Promise<void> {
    const features = await this.getUserFeatures(uid);
    const current = features?.preferenceVector ?? features?.profileVector ?? [];
    const absLR = Math.abs(PREFERENCE_LEARNING_RATE * weight);

    const updated = current.map((val, i) => {
      let targetVal = targetProfileVec[i] ?? 0;
      // برای block وزن منفی است — target را معکوس کن، نه learningRate را
      if (weight < 0) targetVal = 1 - targetVal;
      const newVal = val * PREFERENCE_DECAY + targetVal * absLR;
      return Math.max(0, Math.min(1, newVal)); // clamp [0,1]
    });

    await this.featureRepo.update(
      { userId: uid },
      { preferenceVector: updated },
    );
    await this.redis.del(this.cacheKey(uid));

    // آپدیت Qdrant فقط برای بردار preference — بدون rebuild کامل
    await this.upsertPreferenceToQdrant(uid, updated);
  }

  /**
   * آپدیت فقط preferenceVector در Qdrant بدون rebuild کامل بردار.
   * برای این کار باید بردار فعلی را از Qdrant بخوانیم و preference segment را جایگزین کنیم.
   */
  private async upsertPreferenceToQdrant(
    userId: number,
    newPreference: number[],
  ): Promise<void> {
    try {
      const existing = await this.featureRepo.findOne({ where: { userId } });
      if (!existing) return;

      await this.upsertToQdrant(
        userId,
        {
          profile: existing.profileVector ?? [],
          preference: newPreference,
          behavior: existing.behaviorVector ?? [],
          personality: existing.personalityVector ?? [],
          geo: existing.geoVector ?? [0, 0],
        },
        existing,
        {
          phase: existing.phase as 'cold' | 'warm' | 'hot',
          trustScore: existing.trustScore,
        },
      );
    } catch (err) {
      this.logger.error(
        `Failed to update preference in Qdrant for ${userId}`,
        err,
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
  ): Promise<void> {
    const weightConfig: Record<
      string,
      { key: string; index: number; delta: number }
    > = {
      purchase: { key: 'feature:weights:behavior', index: 2, delta: +0.01 },
      match: { key: 'feature:weights:behavior', index: 4, delta: +0.01 },
      message: { key: 'feature:weights:behavior', index: 3, delta: +0.01 },
      profile_completed: {
        key: 'feature:weights:profile',
        index: 5,
        delta: +0.01,
      },
      block: { key: 'feature:weights:behavior', index: 3, delta: -0.01 },
    };

    const config = weightConfig[event];
    if (!config) return;

    const defaults = config.key.includes('profile')
      ? DEFAULT_PROFILE_WEIGHTS
      : DEFAULT_BEHAVIOR_WEIGHTS;

    const weights = await this.getWeightArray(config.key, defaults);
    weights[config.index] = Math.max(0.1, weights[config.index] + config.delta);
    await this.redis.set(config.key, JSON.stringify(weights));

    this.logger.log(
      `Weight ${config.key}[${config.index}] adjusted (${config.delta > 0 ? '+' : ''}${config.delta}) for event: ${event}`,
    );
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
