export type FeedItemType = 'user' | 'promotion';

export interface FeedUser {
  id: number;
  nickname: string;
  city?: string;
  age?: number;
  gender?: string;
  hobbies_self?: string[];
  values_self?: string[];
  userImages?: { url: string; isMain: boolean }[];
}

export interface FeedRelation {
  isBlocked: boolean;
  blockedByMe: boolean;
  blockedMe: boolean;
  hasLiked: boolean;
  hasSuperLiked: boolean;
  likedByThem: boolean;
  superLikedByThem: boolean;
  isMatch: boolean;
  hasReported: boolean;
  hasMessaged: boolean;
  hasViewed: boolean;
  effectiveState: 'blocked' | 'match' | 'superliked' | 'liked' | 'none';
}

export interface PromotionConfig {
  variant: 'boost' | 'vip' | 'credit' | 'profile' | 'bundle';
  title: string;
  subtitle: string;
  ctaText: string;
  ctaColor: string;
  gradientColors: [string, string, string];
  titleColor: string;
  promoImage: string;
  navigationTarget: string;
  navigationParams?: Record<string, any>;
}

export interface FeedItem {
  id: string;
  type: FeedItemType;
  data: FeedUser | PromotionConfig;
  priority?: number;
  score?: number;
  expiresAt?: Date;
  relation?: FeedRelation;
}

export interface BuildFeedOptions {
  limit?: number;
  excludeUserIds?: number[];
  city?: string;
}
