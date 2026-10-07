export class RelationStatusDto {
  // وضعیت بلاک
  isBlocked = false;
  blockedByMe = false;
  blockedMe = false;

  // لایک و سوپرلایک
  hasLiked = false;
  hasSuperLiked = false;
  likedByThem = false;
  superLikedByThem = false;

  // مچ
  isMatch = false;

  // گزارش
  hasReported = false;

  // پیام و ویو
  hasMessaged = false;
  hasViewed = false;

  // وضعیت نهایی برای UI
  effectiveState: 'blocked' | 'match' | 'superliked' | 'liked' | 'none' =
    'none';
}
