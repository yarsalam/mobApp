import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserFeatureSnapshot } from '../../feature-store/entities/user-feature.entity';
import { BoostQueueService } from '../../redis/boost-queue.service';
import { User } from '../../users/entities/user.entity';
import { REDIS_CLIENT } from 'src/redis/redis.constants';
import Redis from 'ioredis';
import { QdrantClient } from '@qdrant/js-client-rest';
import { FeatureStoreService } from 'src/feature-store/feature-store.service';
import { QDRANT_CLIENT } from 'src/qdrant/qdrant.provider';

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

  private readonly DEFAULT_SEARCH_WEIGHTS = {
    profile: 0.5,
    personality: 0.8,
    behavior: 1.0,
  };

  async findCandidates(userId: number, limit = 200): Promise<number[]> {
    const boostedIds = await this.boostQueue.getBoostedUsers(10);

    const userFeatures = await this.featureRepo.findOne({ where: { userId } });

    let searchVector: number[] | null = null;

    if (userFeatures) {
      // 🆕 استفاده از همان متدی که در FeatureStoreService برای ذخیره استفاده می‌شود
      searchVector = this.featureStore.buildMergedVector(
        userFeatures.profileVector || [],
        userFeatures.preferenceVector || userFeatures.profileVector || [],
        userFeatures.behaviorVector || [],
        userFeatures.personalityVector || [],
        userFeatures.geoVector || [],
      );
    } else {
      // fallback: ساخت بردار پروفایل از user entity و سپس ساختن mergedVector
      const user = await this.userRepo.findOne({
        where: { id: userId, status: 'active' },
      });
      if (user) {
        const profileVec = this.buildProfileVectorFromUser(user);
        const zero5 = [0, 0, 0, 0, 0];
        const zero2 = [0, 0];
        searchVector = this.featureStore.buildMergedVector(
          profileVec,
          profileVec, // ← preference = profile وقتی هنوز یادگیری نداریم
          zero5,
          zero5,
          zero2,
        );
      }
    }
    console.log('VECTOR LENGTH=', searchVector?.length);

    if (!searchVector || searchVector.length === 0) {
      return boostedIds.slice(0, limit);
    }

    const similarIds = await this.findSimilarUsers(
      searchVector,
      limit - boostedIds.length,
      userId,
    );
    return [...new Set([...boostedIds, ...similarIds])]
      .filter((id) => id !== userId)
      .slice(0, limit);
  }

  private async findSimilarUsers(
    searchVector: number[],
    limit: number,
    excludeUserId: number,
  ): Promise<number[]> {
    const cacheKey = `similar:${excludeUserId}:${limit}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
      const results = await this.qdrant.search('user_vectors', {
        vector: searchVector,
        limit: limit + 1,
        filter: {
          must_not: [{ key: 'userId', match: { value: excludeUserId } }],
        },
        with_payload: false,
      });

      const ids = results
        .map((r) => r.id as number)
        .filter((id) => id !== excludeUserId);

      // ✅ فقط کاربران active
      const activeUsers = await this.userRepo.find({
        where: {
          id: In(ids),
          status: 'active',
        },
        select: ['id'],
      });

      const activeIds = activeUsers.map((u) => u.id);
      await this.redis.set(cacheKey, JSON.stringify(activeIds), 'EX', 60);
      return activeIds;
    } catch (err) {
      this.logger.error('Qdrant search failed', err);
      return [];
    }
  }

  private buildProfileVectorFromUser(user: User): number[] {
    return [
      user.city ? 1 : 0,
      user.birth_year
        ? (new Date().getFullYear() - (parseInt(user.birth_year) + 621)) / 100
        : 0,
      Math.min((user.aboutme?.length || 0) / 500, 1),
      (user.hobbies_self?.length || 0) / 10,
      (user.values_self?.length || 0) / 5,
      user.isFaceVerified ? 1 : 0,
      (user.trustScore || 50) / 100,
      user.gender === 'male' ? 1 : 0,
      user.marital ? 1 : 0,
      user.education ? 1 : 0,
    ];
  }
}
