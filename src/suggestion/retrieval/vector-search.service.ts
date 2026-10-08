import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { QdrantClient } from '@qdrant/js-client-rest';
import Redis from 'ioredis';

import { UserFeatureSnapshot } from '../../feature-store/entities/user-feature.entity';
import { BoostQueueService } from '../../redis/boost-queue.service';
import { User } from '../../users/entities/user.entity';

import { REDIS_CLIENT } from 'src/redis/redis.constants';
import { QDRANT_CLIENT } from 'src/qdrant/qdrant.provider';
import { FeatureStoreService } from 'src/feature-store/feature-store.service';
import { QDRANT_COLLECTION } from 'src/feature-store/feature-store.constan';

@Injectable()
export class VectorSearchService {
  private readonly logger = new Logger(VectorSearchService.name);

  constructor(
    @InjectRepository(UserFeatureSnapshot)
    private readonly featureRepo: Repository<UserFeatureSnapshot>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,

    @Inject(QDRANT_CLIENT)
    private readonly qdrant: QdrantClient,

    private readonly boostQueue: BoostQueueService,

    private readonly featureStore: FeatureStoreService,
  ) {}

  /**
   * Retrieval مرکزی یارسلام.
   *
   * ترتیب:
   *
   * 1. ساخت canonical search vector از FeatureStore
   * 2. Retrieval از Qdrant
   * 3. hard filter برای active + target gender
   * 4. اضافه کردن boosted users
   * 5. حذف خود کاربر
   * 6. deduplicate
   *
   * توجه:
   * relation/block/moderation در لایه بالاتر انجام می‌شود،
   * چون این سرویس نباید به آن ماژول‌ها وابسته شود.
   */
  async findCandidates(
    userId: number,
    limit = 200,
    targetGender?: string,
  ): Promise<number[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));

    const userFeatures = await this.featureRepo.findOne({
      where: { userId },
    });

    let searchVector: number[] | null = null;

    // ─────────────────────────────────────────────────────────────
    // مسیر اصلی: FeatureStore
    // ─────────────────────────────────────────────────────────────

    if (userFeatures) {
      const profile = userFeatures.profileVector ?? [];

      const preference = userFeatures.preferenceVector ?? profile;

      const behavior = userFeatures.behaviorVector ?? [];

      const personality = userFeatures.personalityVector ?? [];

      const geo = userFeatures.geoVector ?? [];

      searchVector = this.featureStore.buildMergedVector(
        profile,
        preference,
        behavior,
        personality,
        geo,
      );
    }

    // ─────────────────────────────────────────────────────────────
    // fallback
    // ─────────────────────────────────────────────────────────────

    if (!searchVector || searchVector.length === 0) {
      const user = await this.userRepo.findOne({
        where: {
          id: userId,
          status: 'active',
        },
      });

      if (user) {
        const profileVector = this.buildProfileVectorFromUser(user);

        searchVector = this.featureStore.buildMergedVector(
          profileVector,
          profileVector,
          [0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0],
          [0, 0],
        );
      }
    }

    if (!searchVector || searchVector.length === 0) {
      return this.getFallbackCandidates(userId, safeLimit, targetGender);
    }

    // ─────────────────────────────────────────────────────────────
    // Retrieval
    // ─────────────────────────────────────────────────────────────

    const retrievalLimit = Math.min(safeLimit * 2, 500);

    const similarIds = await this.findSimilarUsers(
      searchVector,
      retrievalLimit,
      userId,
      targetGender,
    );

    // ─────────────────────────────────────────────────────────────
    // Boost
    //
    // Boost دیگر bypass برای active/gender نیست.
    // ابتدا candidate می‌شود، سپس validate می‌شود.
    // ─────────────────────────────────────────────────────────────

    const boostedIds = await this.getValidBoostedUsers(
      userId,
      targetGender,
      safeLimit,
    );

    const merged = [...boostedIds, ...similarIds];

    const uniqueIds = [...new Set(merged)]
      .filter((id) => id !== userId)
      .slice(0, safeLimit);

    return uniqueIds;
  }

  /**
   * Retrieval واقعی از Qdrant.
   *
   * gender و active در خود Qdrant فیلتر می‌شوند،
   * بنابراین تعداد candidateهای بی‌استفاده کاهش پیدا می‌کند.
   */
  private async findSimilarUsers(
    searchVector: number[],
    limit: number,
    excludeUserId: number,
    targetGender?: string,
  ): Promise<number[]> {
    const genderKey = targetGender ?? 'any';

    const cacheKey = `similar:${excludeUserId}:${genderKey}:${limit}`;

    const cached = await this.redis.get(cacheKey);

    if (cached) {
      try {
        return JSON.parse(cached) as number[];
      } catch {
        await this.redis.del(cacheKey);
      }
    }

    try {
      const must: Array<Record<string, unknown>> = [];

      // فقط کاربران active
      must.push({
        key: 'status',
        match: {
          value: 'active',
        },
      });

      // target gender
      if (targetGender) {
        must.push({
          key: 'gender',
          match: {
            value: targetGender,
          },
        });
      }

      const result = await this.qdrant.search(QDRANT_COLLECTION, {
        vector: searchVector,
        limit: Math.min(limit + 1, 500),

        filter: {
          must,
          must_not: [
            {
              key: 'userId',
              match: {
                value: excludeUserId,
              },
            },
          ],
        },

        with_payload: false,
      });

      const ids = result
        .map((item) => Number(item.id))
        .filter((id) => Number.isFinite(id) && id !== excludeUserId);

      // ─────────────────────────────────────────────
      // DB validation
      //
      // Qdrant payload ممکن است stale باشد.
      // DB آخرین مرجع وضعیت کاربر است.
      // ─────────────────────────────────────────────

      if (ids.length === 0) {
        await this.redis.set(cacheKey, JSON.stringify([]), 'EX', 30);

        return [];
      }

      const where: Record<string, unknown> = {
        id: In(ids),
        status: 'active',
      };

      if (targetGender) {
        where.gender = targetGender;
      }

      const activeUsers = await this.userRepo.find({
        where,
        select: ['id'],
      });

      const activeSet = new Set(activeUsers.map((user) => user.id));

      // ترتیب Qdrant حفظ می‌شود
      const activeIds = ids.filter((id) => activeSet.has(id));

      await this.redis.set(cacheKey, JSON.stringify(activeIds), 'EX', 60);

      return activeIds;
    } catch (error) {
      this.logger.error(
        'Qdrant candidate retrieval failed',
        error instanceof Error ? error.stack : String(error),
      );

      return [];
    }
  }

  /**
   * Boost فقط زمانی وارد candidate pool می‌شود
   * که واقعاً active و targetGender صحیح باشد.
   */
  private async getValidBoostedUsers(
    excludeUserId: number,
    targetGender: string | undefined,
    limit: number,
  ): Promise<number[]> {
    try {
      const boostedIds = await this.boostQueue.getBoostedUsers(
        Math.min(limit * 2, 100),
      );

      if (!boostedIds.length) {
        return [];
      }

      const ids = boostedIds
        .map(Number)
        .filter((id) => Number.isFinite(id) && id !== excludeUserId);

      if (!ids.length) {
        return [];
      }

      const where: Record<string, unknown> = {
        id: In(ids),
        status: 'active',
      };

      if (targetGender) {
        where.gender = targetGender;
      }

      const users = await this.userRepo.find({
        where,
        select: ['id'],
      });

      const valid = new Set(users.map((user) => user.id));

      // ترتیب BoostQueue حفظ می‌شود
      return ids.filter((id) => valid.has(id)).slice(0, limit);
    } catch (error) {
      this.logger.warn(
        `Failed to retrieve boosted candidates: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return [];
    }
  }

  /**
   * اگر FeatureStore هنوز برای کاربر ساخته نشده باشد،
   * یک fallback سبک از DB استفاده می‌کنیم.
   */
  private async getFallbackCandidates(
    userId: number,
    limit: number,
    targetGender?: string,
  ): Promise<number[]> {
    try {
      const where: Record<string, unknown> = {
        status: 'active',
      };

      if (targetGender) {
        where.gender = targetGender;
      }

      const users = await this.userRepo.find({
        where,
        select: ['id'],
        take: Math.min(limit * 2, 500),
        order: {
          updatedAt: 'DESC',
        },
      });

      return users
        .map((user) => user.id)
        .filter((id) => id !== userId)
        .slice(0, limit);
    } catch (error) {
      this.logger.error(
        'Fallback candidate retrieval failed',
        error instanceof Error ? error.stack : String(error),
      );

      return [];
    }
  }

  /**
   * فقط fallback اولیه.
   *
   * مسیر اصلی Retrieval نباید از این استفاده کند.
   */
  private buildProfileVectorFromUser(user: User): number[] {
    const birthYear = user.birth_year
      ? parseInt(String(user.birth_year), 10)
      : 0;

    let age = 0;

    if (birthYear > 1300 && birthYear < 1420) {
      age = new Date().getFullYear() - (birthYear + 621);
    } else if (birthYear > 1900) {
      age = new Date().getFullYear() - birthYear;
    }

    age = Math.max(0, Math.min(100, age));

    return [
      user.city ? 1 : 0,
      age / 100,
      Math.min((user.aboutme?.length ?? 0) / 500, 1),
      Math.min((user.hobbies_self?.length ?? 0) / 10, 1),
      Math.min((user.values_self?.length ?? 0) / 5, 1),
      user.isFaceVerified ? 1 : 0,
      (user.trustScore ?? 50) / 100,
      user.gender === 'male' ? 1 : 0,
      user.marital ? 1 : 0,
      user.education ? 1 : 0,
    ];
  }
}
