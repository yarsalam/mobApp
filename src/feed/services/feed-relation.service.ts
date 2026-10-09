import { Injectable } from '@nestjs/common';
import { RelationStatusService } from '../../relation-status/relation-status.service';
import { FeedItem, FeedRelation, FeedUser } from '../types/feed.types';

@Injectable()
export class FeedRelationService {
  constructor(private readonly relationStatus: RelationStatusService) {}

  async filterBlockedUsers(
    userId: number,
    targetIds: number[],
  ): Promise<Map<number, FeedRelation>> {
    const uniqueTargetIds = [
      ...new Set(
        targetIds.filter(
          (id) => Number.isSafeInteger(id) && id > 0 && id !== userId,
        ),
      ),
    ];

    if (uniqueTargetIds.length === 0) {
      return new Map<number, FeedRelation>();
    }

    const relations = await this.relationStatus.getEffectiveRelationsBatch(
      userId,
      uniqueTargetIds,
    );

    const result = new Map<number, FeedRelation>();

    for (const [targetId, dto] of relations) {
      result.set(targetId, {
        isBlocked: dto.isBlocked,
        blockedByMe: dto.blockedByMe,
        blockedMe: dto.blockedMe,
        hasLiked: dto.hasLiked,
        hasSuperLiked: dto.hasSuperLiked,
        likedByThem: dto.likedByThem,
        superLikedByThem: dto.superLikedByThem,
        isMatch: dto.isMatch,
        hasReported: dto.hasReported,
        hasMessaged: dto.hasMessaged,
        hasViewed: dto.hasViewed,
        effectiveState: dto.effectiveState,
      });
    }

    return result;
  }

  applyRelationFilter(
    feed: FeedItem[],
    relationsMap: Map<number, FeedRelation>,
  ): FeedItem[] {
    const result: FeedItem[] = [];

    for (const item of feed) {
      if (item.type !== 'user') {
        result.push(item);
        continue;
      }

      const user = item.data as FeedUser;
      const relation = relationsMap.get(user.id);

      // اگر یکی از دو طرف دیگری را بلاک کرده باشد، نمایش داده نشود.
      if (relation?.isBlocked) {
        continue;
      }

      result.push({
        ...item,
        ...(relation ? { relation } : {}),
      });
    }

    return result;
  }
}
