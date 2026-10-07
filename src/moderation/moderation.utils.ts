/**
 * توابع کمکی مودریشن که در چند ماژول مشترک استفاده می‌شوند.
 * بدون dependency injection، pure utility.
 */

export interface ModerationCheckable {
  canSendMessage?: boolean;
  restrictedUntil?: Date | string | null;
  trustScore?: number;
  createdAt?: Date | string;
}

/**
 * آیا کاربر مجاز است در فید/پیشنهادها نمایش داده شود؟
 * نقطه مرکزی تصمیم‌گیری — همه جا فقط همین را صدا بزن.
 *
 * در آینده اگر multi-level moderation اضافه شد
 * (warning / limited / shadow / banned)
 * فقط همین یک تابع تغییر می‌کند.
 */
export function canAppearInFeed(user: ModerationCheckable): boolean {
  // ممنوع شده توسط مودریشن
  if (user.canSendMessage === false) return false;

  // محدودیت موقت هنوز فعال است
  if (user.restrictedUntil && new Date(user.restrictedUntil) > new Date()) {
    return false;
  }

  return true;
}

/**
 * محاسبه ضریب تازگی برای کاربران جدید.
 * فقط بر ترتیب نمایش تأثیر می‌گذارد، نه روی ML score.
 *
 * ≤ 3 روز  → 1.5×  (دیده شدن اولیه)
 * ≤ 7 روز  → 1.3×
 * ≤ 14 روز → 1.15×
 * بیشتر    → 1.0×  (بدون boost)
 */
export function calculateFreshnessBoost(createdAt: Date | string): number {
  const accountAgeDays = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24),
  );

  if (accountAgeDays <= 3) return 1.5;
  if (accountAgeDays <= 7) return 1.3;
  if (accountAgeDays <= 14) return 1.15;
  return 1.0;
}

/**
 * محاسبه ضریب اعتماد.
 * این یک re-ranking factor است، نه بخشی از ML score.
 * بازه: [0.7, 1.3]
 */
export function calculateTrustMultiplier(trustScore: number): number {
  const clamped = Math.max(0, Math.min(100, trustScore));
  return 0.7 + (clamped / 100) * 0.6;
}
