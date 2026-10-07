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
}

export interface BuildFeedOptions {
  limit?: number;
  excludeUserIds?: number[];
  city?: string;
}
