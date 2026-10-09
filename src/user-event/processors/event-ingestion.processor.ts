import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { PartitionedEvent } from '../entities/partitioned-event.entity';
import { EventType } from '../type/event-type.enum';

import { UserMetricsService } from 'src/user-metrics/user-metrics.service';
import { FeatureStoreService } from 'src/feature-store/feature-store.service';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/redis/redis.constants';

interface EventIngestionJob {
  eventId: number;
  userId: number;
  type: string;
}

interface EventLearningConfig {
  weight: number;
  confidence: number;
  direction: 'positive' | 'negative';
}

@Injectable()
@Processor('event-ingestion')
export class EventIngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(EventIngestionProcessor.name);

  /**
   * حداکثر سنی که برای یک سیگنال preference در نظر می‌گیریم.
   *
   * بعد از 90 روز یک رفتار قدیمی هنوز کاملاً بی‌اثر نیست،
   * اما اثر آن به شکل محسوسی کاهش پیدا کرده است.
   */
  private readonly preferenceHalfLifeDays = 30;

  constructor(
    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,

    private readonly userMetricsService: UserMetricsService,

    private readonly featureStore: FeatureStoreService,

    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job<EventIngestionJob>): Promise<void> {
    const { eventId, userId } = job.data;

    if (
      !Number.isSafeInteger(eventId) ||
      eventId <= 0 ||
      !Number.isSafeInteger(userId) ||
      userId <= 0
    ) {
      throw new Error(
        `Invalid event-ingestion job: ${JSON.stringify(job.data)}`,
      );
    }

    const completedKey = `event-ingestion:completed:${eventId}`;
    const lockKey = `event-ingestion:lock:${eventId}`;

    // رویدادی که قبلاً کامل شده، نباید دوباره یادگیری شود.
    if (await this.redis.exists(completedKey)) {
      this.logger.debug(`Skipping completed event=${eventId}`);
      return;
    }

    // توکن اختصاصی برای جلوگیری از آزاد کردن قفل متعلق به worker دیگر.
    const lockToken = `${String(job.id ?? eventId)}:${Date.now()}:${Math.random()}`;

    const acquired = await this.redis.set(lockKey, lockToken, 'EX', 300, 'NX');

    if (acquired !== 'OK') {
      // اجازه بده BullMQ پس از تأخیر، دوباره تلاش کند.
      throw new Error(`Event ${eventId} is already being processed`);
    }

    try {
      // ممکن است اجرای دیگری پیش از گرفتن قفل، پردازش را تمام کرده باشد.
      if (await this.redis.exists(completedKey)) {
        this.logger.debug(`Skipping completed event=${eventId}`);
        return;
      }

      const event = await this.eventRepo.findOne({
        where: {
          id: eventId,
          userId,
        },
      });

      if (!event) {
        throw new Error(`Event ${eventId} for user ${userId} was not found`);
      }

      await this.processMetrics(event);
      await this.learnFromEvent(event);

      // فقط پس از اتمام موفق مراحل بالا، رویداد کامل‌شده علامت‌گذاری می‌شود.
      await this.redis.set(completedKey, '1', 'EX', 90 * 24 * 60 * 60);

      this.logger.debug(
        `Learning loop processed event=${event.id} ` +
          `type=${event.type} user=${event.userId}`,
      );
    } finally {
      // فقط مالک قفل اجازه آزاد کردن آن را دارد.
      await this.redis.eval(
        `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        end
        return 0
      `,
        1,
        lockKey,
        lockToken,
      );
    }
  }

  // ───────────────────────────────────────────────────────────
  // METRICS
  // ───────────────────────────────────────────────────────────

  private async processMetrics(event: PartitionedEvent): Promise<void> {
    /**
     * UserMetricsService منبع canonical metrics است.
     *
     * Feature learning در learnFromEvent انجام می‌شود.
     */
    await this.userMetricsService.getUserIntelligenceMetrics(event.userId);
  }

  // ───────────────────────────────────────────────────────────
  // LEARNING LOOP
  // ───────────────────────────────────────────────────────────

  private async learnFromEvent(event: PartitionedEvent): Promise<void> {
    const type = event.type as EventType;

    const preferenceConfig = this.getPreferenceLearningConfig(type);

    // ─────────────────────────────────────────────────────────
    // TARGET PREFERENCE
    // ─────────────────────────────────────────────────────────

    if (preferenceConfig) {
      await this.learnTargetPreference(
        event,
        preferenceConfig.weight,
        preferenceConfig.confidence,
        preferenceConfig.direction,
      );
    }

    // ─────────────────────────────────────────────────────────
    // FEATURE WEIGHTS
    // ─────────────────────────────────────────────────────────

    switch (type) {
      // ────────────────────────────────────────────────────────
      // POSITIVE MATCH SIGNAL
      // ────────────────────────────────────────────────────────

      case EventType.LIKE:
      case EventType.SUPERLIKE:
      case EventType.MATCH:
        await this.featureStore.learnFeatureWeights(
          event.userId,
          'match',
          event.id,
        );
        break;

      // ────────────────────────────────────────────────────────
      // NEGATIVE SIGNAL
      // ────────────────────────────────────────────────────────

      case EventType.USER_BLOCKED:
        await this.featureStore.learnFeatureWeights(
          event.userId,
          'block',
          event.id,
        );
        break;

      // ────────────────────────────────────────────────────────
      // ENGAGEMENT
      // ────────────────────────────────────────────────────────

      case EventType.MESSAGE_SENT:
        await this.featureStore.learnFeatureWeights(
          event.userId,
          'message',
          event.id,
        );
        break;

      // ────────────────────────────────────────────────────────
      // REVENUE
      // ────────────────────────────────────────────────────────

      case EventType.PURCHASE:
      case EventType.PAYMENT_CONFIRMED:
      case EventType.BOOST_USED:
        await this.featureStore.learnFeatureWeights(
          event.userId,
          'purchase',
          event.id,
        );

        await this.refreshUserFeatures(event.userId);
        break;

      // ────────────────────────────────────────────────────────
      // PROFILE
      // ────────────────────────────────────────────────────────

      case EventType.PROFILE_UPDATE:
        await this.featureStore.learnFeatureWeights(
          event.userId,
          'profile_completed',
          event.id,
        );

        await this.refreshUserFeatures(event.userId);
        break;

      case EventType.PHOTO_UPLOAD:
        await this.refreshUserFeatures(event.userId);
        break;

      // ────────────────────────────────────────────────────────
      // RETENTION
      // ────────────────────────────────────────────────────────

      case EventType.APP_OPEN:
      case EventType.LOGIN:
        /**
         * برای APP_OPEN / LOGIN نیازی نیست
         * Qdrant را بلافاصله rebuild کنیم.
         *
         * Metrics در event stream ثبت می‌شوند
         * و refresh دوره‌ای آنها را وارد FeatureStore می‌کند.
         */
        break;

      default:
        break;
    }
  }

  // ───────────────────────────────────────────────────────────
  // PREFERENCE CONFIGURATION
  // ───────────────────────────────────────────────────────────

  private getPreferenceLearningConfig(
    type: EventType,
  ): EventLearningConfig | null {
    switch (type) {
      /**
       * Like:
       * علاقه‌ی واقعی است، ولی هنوز سیگنال خیلی قوی نیست.
       */
      case EventType.LIKE:
        return {
          weight: 0.5,
          confidence: 0.7,
          direction: 'positive',
        };

      /**
       * SuperLike:
       * سیگنال بسیار قوی‌تر از Like.
       */
      case EventType.SUPERLIKE:
        return {
          weight: 0.9,
          confidence: 0.9,
          direction: 'positive',
        };

      /**
       * Match:
       * قوی‌ترین سیگنال preference.
       *
       * چون Match نتیجه‌ی علاقه‌ی دوطرفه است.
       */
      case EventType.MATCH:
        return {
          weight: 1.0,
          confidence: 1.0,
          direction: 'positive',
        };

      /**
       * Skip:
       * سیگنال منفی است، ولی نباید به اندازه Block
       * preference را تغییر دهد.
       */
      case EventType.SKIP:
        return {
          weight: 0.35,
          confidence: 0.55,
          direction: 'negative',
        };

      /**
       * Block:
       * سیگنال بسیار قوی منفی.
       */
      case EventType.USER_BLOCKED:
        return {
          weight: 1.0,
          confidence: 1.0,
          direction: 'negative',
        };

      default:
        return null;
    }
  }

  // ───────────────────────────────────────────────────────────
  // TARGET PREFERENCE LEARNING
  // ───────────────────────────────────────────────────────────

  private async learnTargetPreference(
    event: PartitionedEvent,
    baseWeight: number,
    confidence: number,
    direction: 'positive' | 'negative',
  ): Promise<void> {
    if (!event.targetUserId) {
      return;
    }

    const targetVector = await this.featureStore.getProfileVector(
      event.targetUserId,
    );

    if (!targetVector?.length) {
      return;
    }

    /**
     * سیگنال نهایی:
     *
     * baseWeight
     * × recencyDecay
     * × confidence
     *
     * بنابراین:
     *
     * Like امروز:
     *   0.5 × ~1.0 × 0.70 ≈ 0.35
     *
     * Like قدیمی:
     *   0.5 × ~0.5 × 0.70 ≈ 0.175
     *
     * Match:
     *   1.0 × recency × 1.0
     */

    const recencyDecay = this.calculateRecencyDecay(event);

    const effectiveWeight = this.clamp(
      baseWeight * recencyDecay * confidence,
      0,
      1,
    );

    if (effectiveWeight <= 0) {
      return;
    }

    /**
     * از API قدیمی updatePreferenceVector استفاده می‌کنیم
     * تا backward compatibility حفظ شود.
     *
     * weight مثبت:
     *   positive preference
     *
     * weight منفی:
     *   negative preference
     */
    const signedWeight =
      direction === 'positive' ? effectiveWeight : -effectiveWeight;

    await this.featureStore.updatePreferenceVector(
      event.userId,
      targetVector,
      signedWeight,
      event.id,
    );

    this.logger.debug(
      [
        `Preference learned`,
        `event=${event.id}`,
        `type=${event.type}`,
        `user=${event.userId}`,
        `target=${event.targetUserId}`,
        `direction=${direction}`,
        `base=${baseWeight.toFixed(3)}`,
        `confidence=${confidence.toFixed(3)}`,
        `decay=${recencyDecay.toFixed(3)}`,
        `effective=${effectiveWeight.toFixed(3)}`,
      ].join(' '),
    );
  }

  // ───────────────────────────────────────────────────────────
  // RECENCY DECAY
  // ───────────────────────────────────────────────────────────

  private calculateRecencyDecay(event: PartitionedEvent): number {
    /**
     * createdAt را به صورت defensive می‌خوانیم تا
     * اگر entity فعلی timestamp متفاوتی داشت،
     * processor باعث crash نشود.
     */
    const rawCreatedAt = (
      event as unknown as {
        createdAt?: Date | string;
      }
    ).createdAt;

    if (!rawCreatedAt) {
      /**
       * اگر timestamp موجود نبود،
       * فرض می‌کنیم event تازه است.
       */
      return 1;
    }

    const createdAt = new Date(rawCreatedAt);

    if (Number.isNaN(createdAt.getTime())) {
      return 1;
    }

    const ageMs = Math.max(0, Date.now() - createdAt.getTime());

    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    /**
     * Exponential half-life:
     *
     * decay = 0.5 ^ (age / halfLife)
     *
     * 0 روز  → 1.00
     * 30 روز → 0.50
     * 60 روز → 0.25
     * 90 روز → 0.125
     */
    const decay = Math.pow(0.5, ageDays / this.preferenceHalfLifeDays);

    /**
     * یک کف کوچک نگه می‌داریم تا eventهای خیلی قدیمی
     * کاملاً صفر نشوند.
     */
    return this.clamp(decay, 0.05, 1);
  }

  // ───────────────────────────────────────────────────────────
  // FEATURE REFRESH
  // ───────────────────────────────────────────────────────────

  private async refreshUserFeatures(userId: number): Promise<void> {
    try {
      await this.featureStore.refreshSingle(userId);
    } catch (error) {
      this.logger.error(
        `Feature refresh failed for user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );

      throw error;
    }
  }

  // ───────────────────────────────────────────────────────────
  // UTILS
  // ───────────────────────────────────────────────────────────

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
