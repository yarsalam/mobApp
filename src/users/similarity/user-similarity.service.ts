import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { MoreThan, Not, Repository } from 'typeorm';
import { RelationStatusService } from 'src/relation-status/relation-status.service';
import { FeatureStoreService } from 'src/feature-store/feature-store.service';
import { getTargetGender } from 'src/common/utils/gender.util';
import { UserFeatureSnapshot } from 'src/feature-store/entities/user-feature.entity';

export interface SimilarUserResult {
  id: number;
  nickname: string;
  city?: string;
  similarityScore: number;
  avatar: string | null;
  relation?: unknown;
}
@Injectable()
export class UserSimilarityService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly featureStore: FeatureStoreService,
    private readonly relationStatus: RelationStatusService,
  ) {}

  async findRecentSimilarUsers(
    userId: number,
    limit: number = 5,
    daysAgo: number = 30,
  ): Promise<SimilarUserResult[]> {
    const since = new Date();
    since.setDate(since.getDate() - daysAgo);

    // ← یک‌بار findOne برای gender + بعداً هم برای featureSnapshot استفاده می‌شه
    const currentUserEntity = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'gender'], // فقط همین دو تا لازمه
    });
    const targetGender = getTargetGender(currentUserEntity?.gender);

    const recentUsers = await this.userRepository.find({
      where: {
        createdAt: MoreThan(since),
        id: Not(userId),
        gender: targetGender,
        status: 'active',
      },
      relations: ['userImages'],
      select: [
        'id',
        'nickname',
        'city',
        'gender',
        'birth_year',
        'aboutme',
        'hobbies_self',
        'values_self',
        'isFaceVerified',
        'trustScore',
        'education',
        'marital',
      ],
    });

    if (recentUsers.length === 0) return [];

    const ids = recentUsers.map((u) => u.id);
    const relationsMap = await this.relationStatus.getEffectiveRelationsBatch(
      userId,
      ids,
    );

    const filteredUsers = recentUsers.filter(
      (u) => !relationsMap.get(u.id)?.isBlocked,
    );
    if (filteredUsers.length === 0) return [];

    // ← اسم عوض شد: featureSnapshot به‌جای currentUser
    const featureSnapshot = await this.findUserFeatureSnapshot(userId);

    let scored = filteredUsers.map((u) => ({
      ...u,
      similarityScore: 0,
      avatar: u.userImages?.[0]?.url || null,
    }));

    // ← profileVector روی featureSnapshot چک می‌شه، نه روی User entity
    if (featureSnapshot?.profileVector) {
      const currentVec = featureSnapshot.profileVector;
      scored = filteredUsers.map((u) => {
        const vec = this.buildSimpleVector(u);
        const similarity = this.cosineSimilarity(currentVec, vec);
        return {
          ...u,
          similarityScore: similarity,
          avatar: u.userImages?.[0]?.url || null,
        };
      });
      scored.sort((a, b) => b.similarityScore - a.similarityScore);
    }

    return scored.slice(0, limit).map((u) => ({
      ...u,
      relation: relationsMap.get(u.id),
    }));
  }

  private async findUserFeatureSnapshot(
    userId: number,
  ): Promise<UserFeatureSnapshot | null> {
    // فرض می‌کنیم FeatureStoreService را در UsersService تزریق کرده‌اید
    return this.featureStore.getUserFeatures(userId).catch(() => null);
  }

  private buildSimpleVector(user: User): number[] {
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

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || !b.length) return 0;
    const dot = a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
    const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return normA && normB ? dot / (normA * normB) : 0;
  }
}
