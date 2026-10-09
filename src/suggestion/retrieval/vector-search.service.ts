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

  async findCandidates(
    userId: number,
    limit = 200,
    targetGender?: string,
  ): Promise<number[]> {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return [];
    }

    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));

    const userFeatures = await this.featureRepo.findOne({
      where: { userId },
    });

    let searchVector: number[] | null = null;

    if (userFeatures) {
      const profile = this.normalizeVector(
        userFeatures.profileVector ?? [],
        10,
      );

      const preference = this.normalizeVector(
        userFeatures.preferenceVector?.length
          ? userFeatures.preferenceVector
          : profile,
        10,
      );

      const behavior = this.normalizeVector(
        userFeatures.behaviorVector ?? [],
        5,
      );

      const personality = this.normalizeVector(
        userFeatures.personalityVector ?? [],
        5,
      );

      const geo = this.normalizeVector(userFeatures.geoVector ?? [], 2);

      searchVector = this.featureStore.buildMergedVector(
        profile,
        preference,
        behavior,
        personality,
        geo,
      );
    }

    if (!searchVector || searchVector.length !== 32) {
      const user = await this.userRepo.findOne({
        where: { id: userId, status: 'active' },
      });

      if (user) {
        const profile = this.buildProfileVectorFromUser(user);

        searchVector = this.featureStore.buildMergedVector(
          profile,
          profile,
          [0, 0, 0, 0, 0],
          [0.5, 0.5, 0.5, 0.5, 0.5],
          [0, 0],
        );
      }
    }

    if (!searchVector || searchVector.length !== 32) {
      return this.getFallbackCandidates(userId, safeLimit, targetGender);
    }

    const retrievalLimit = Math.min(Math.max(safeLimit * 5, 100), 500);

    const [similarIds, boostedIds] = await Promise.all([
      this.findSimilarUsers(searchVector, retrievalLimit, userId, targetGender),
      this.getValidBoostedUsers(
        userId,
        targetGender,
        Math.min(safeLimit * 2, 100),
      ),
    ]);

    /*
     * ترتیب اولیه فقط برای بازیابی است؛ رتبه‌بندی نهایی
     * توسط RevenueScorerService و MMR انجام می‌شود.
     */
    const merged = this.uniqueIds([...similarIds, ...boostedIds]).filter(
      (id) => id !== userId,
    );

    if (merged.length >= safeLimit) {
      return merged.slice(0, safeLimit);
    }

    /*
     * اگر Qdrant نتیجهٔ کافی نداد یا موقتاً در دسترس نبود،
     * از دیتابیس برای تکمیل candidate pool استفاده می‌کنیم.
     */
    const fallbackIds = await this.getFallbackCandidates(
      userId,
      Math.min(safeLimit * 2, 500),
      targetGender,
    );

    return this.uniqueIds([...merged, ...fallbackIds])
      .filter((id) => id !== userId)
      .slice(0, safeLimit);
  }

  private async findSimilarUsers(
    searchVector: number[],
    limit: number,
    excludeUserId: number,
    targetGender?: string,
  ): Promise<number[]> {
    const genderKey = targetGender ?? 'any';
    const cacheKey = `similar:${excludeUserId}:${genderKey}:${limit}`;

    /*
     * Redis صرفاً cache است؛ وضعیت فعال بودن کاربران
     * در هر بار خواندن cache دوباره از دیتابیس بررسی می‌شود.
     */
    try {
      const cached = await this.redis.get(cacheKey);

      if (cached) {
        try {
          const parsed: unknown = JSON.parse(cached);

          if (
            Array.isArray(parsed) &&
            parsed.every((id) => Number.isSafeInteger(id) && id > 0)
          ) {
            const cachedIds = this.uniqueIds(parsed as number[]).filter(
              (id) => id !== excludeUserId,
            );

            const validated = await this.validateActiveUsers(
              cachedIds,
              targetGender,
            );

            if (validated.length > 0) {
              return validated.slice(0, limit);
            }
          }

          await this.redis.del(cacheKey);
        } catch {
          await this.redis.del(cacheKey);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Redis candidate cache unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      const must: Array<Record<string, unknown>> = [];

      if (targetGender) {
        must.push({
          key: 'gender',
          match: { value: targetGender },
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
              match: { value: excludeUserId },
            },
          ],
        },
        with_payload: false,
      });

      /*
       * ترتیب Qdrant بر اساس شباهت است؛ بنابراین فقط
       * duplicateها حذف می‌شوند و ترتیب رتبه حفظ می‌شود.
       */
      const ids = this.uniqueIds(
        result
          .map((item) => Number(item.id))
          .filter(
            (id) => Number.isSafeInteger(id) && id > 0 && id !== excludeUserId,
          ),
      );

      if (ids.length === 0) {
        await this.cacheIds(cacheKey, []);
        return [];
      }

      const activeIds = await this.validateActiveUsers(ids, targetGender);

      await this.cacheIds(cacheKey, activeIds);

      return activeIds.slice(0, limit);
    } catch (error) {
      this.logger.error(
        'Qdrant candidate retrieval failed',
        error instanceof Error ? error.stack : String(error),
      );

      // fallback در findCandidates اجرا خواهد شد.
      return [];
    }
  }

  private async validateActiveUsers(
    ids: number[],
    targetGender?: string,
  ): Promise<number[]> {
    const uniqueIds = this.uniqueIds(ids);

    if (uniqueIds.length === 0) {
      return [];
    }

    const where: Record<string, unknown> = {
      id: In(uniqueIds),
      status: 'active',
    };

    if (targetGender) {
      where.gender = targetGender;
    }

    const users = await this.userRepo.find({
      where,
      select: ['id'],
    });

    const activeIds = new Set(users.map((user) => Number(user.id)));

    // ترتیب ورودی حفظ می‌شود؛ مرتب‌سازی دیتابیس جایگزین
    // رتبه‌بندی شباهت Qdrant نمی‌شود.
    return uniqueIds.filter((id) => activeIds.has(id));
  }

  private async cacheIds(cacheKey: string, ids: number[]): Promise<void> {
    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(ids),
        'EX',
        ids.length > 0 ? 45 : 15,
      );
    } catch (error) {
      this.logger.debug(
        `Could not cache candidate IDs: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async getValidBoostedUsers(
    excludeUserId: number,
    targetGender: string | undefined,
    limit: number,
  ): Promise<number[]> {
    try {
      const boostedIds = await this.boostQueue.getBoostedUsers(
        Math.min(Math.max(limit * 2, 10), 100),
      );

      const ids = this.uniqueIds(
        boostedIds.map(Number).filter((id) => id !== excludeUserId),
      );

      if (ids.length === 0) return [];

      const validIds = await this.validateActiveUsers(ids, targetGender);

      return validIds.slice(0, limit);
    } catch (error) {
      this.logger.warn(
        `Failed to retrieve boosted candidates: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return [];
    }
  }

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
        take: Math.min(Math.max(limit * 3, limit + 10), 500),
        order: { updatedAt: 'DESC' },
      });

      return this.uniqueIds(
        users
          .map((user) => Number(user.id))
          .filter((id) => Number.isSafeInteger(id) && id > 0 && id !== userId),
      ).slice(0, limit);
    } catch (error) {
      this.logger.error(
        'Fallback candidate retrieval failed',
        error instanceof Error ? error.stack : String(error),
      );

      return [];
    }
  }

  private uniqueIds(ids: number[]): number[] {
    return [
      ...new Set(
        (ids ?? []).filter((id) => Number.isSafeInteger(id) && id > 0),
      ),
    ];
  }

  private normalizeVector(
    vector: number[] | undefined,
    dimension: number,
  ): number[] {
    const result = (Array.isArray(vector) ? vector : [])
      .slice(0, dimension)
      .map((value) => (Number.isFinite(value) ? value : 0));

    while (result.length < dimension) {
      result.push(0);
    }

    return result;
  }

  private buildProfileVectorFromUser(user: User): number[] {
    const birthYear = user.birth_year
      ? Number.parseInt(String(user.birth_year), 10)
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
