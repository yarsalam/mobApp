import { Injectable } from '@nestjs/common';
import { RelationStatusService } from '../../relation-status/relation-status.service';
import { FeedItem } from '../types/feed.types';

@Injectable()
export class FeedRelationService {
  constructor(private readonly relationStatus: RelationStatusService) {}

  async filterBlockedUsers(
    userId: number,
    targetIds: number[],
  ): Promise<Map<number, any>> {
    if (targetIds.length === 0) return new Map();
    return this.relationStatus.getEffectiveRelationsBatch(userId, targetIds);
  }

  applyRelationFilter(
    feed: FeedItem[],
    relationsMap: Map<number, any>,
  ): FeedItem[] {
    return feed.filter((item) => {
      if (item.type === 'user') {
        const uid = (item.data as any).id;
        const rel = relationsMap.get(uid);
        if (rel?.isBlocked) return false;
        (item as any).relation = rel;
      }
      return true;
    });
  }
}
