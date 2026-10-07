/**
 * ثابت‌های مرکزی Feature Store
 *
 * هر بار که بُعد یک segment تغییر می‌کند:
 *   1. عدد آن segment را اینجا تغییر بده
 *   2. total را آپدیت کن
 *   3. Collection جدید در Qdrant بساز (یا migrate کن)
 */

export const CACHE_KEY_PREFIX = 'feature_snapshot';
export const QDRANT_COLLECTION = 'user_vectors';

// ─── ابعاد بردارها ──────────────────────────────────────────────────────────

export const VECTOR_DIMS = {
  profile: 10, // city, age, bio_len, hobbies, values, verified, trust, gender, marital, education
  preference: 10, // یادگرفته‌شده از رفتار — با profileVector شروع می‌شود
  behavior: 5, // totalEvents, activeDays, purchaseRate, responseRate, matchRate
  personality: 5, // OCEAN: O, C, E, A, N
  geo: 2, // lat, lng (normalize شده به [-1, 1])
  get total() {
    return (
      this.profile +
      this.preference +
      this.behavior +
      this.personality +
      this.geo
    );
    // = 10 + 10 + 5 + 5 + 2 = 32
  },
} as const;

// ─── وزن‌های Segment در بردار ترکیبی ─────────────────────────────────────────
//
// چرا sqrt؟
// Cosine similarity روی بردار concatenate‌شده معادل weighted sum است
// اگر وزن‌ها را به شکل sqrt اعمال کنیم.
// مثال: weight=0.5 → sqrt(0.5) ≈ 0.707 روی هر بُعد آن segment
//
export const SEGMENT_WEIGHTS = {
  profile: Math.sqrt(0.3), // 0.5477 — پروفایل ثابت
  preference: Math.sqrt(0.35), // 0.5916 — ترجیح یادگرفته‌شده (مهم‌ترین)
  behavior: Math.sqrt(0.2), // 0.4472
  personality: Math.sqrt(0.1), // 0.3162
  geo: Math.sqrt(0.05), // 0.2236 — کم‌ترین اثر روی cosine
} as const;

// ─── وزن‌های پیش‌فرض ویژگی‌ها ────────────────────────────────────────────────

export const DEFAULT_PROFILE_WEIGHTS = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]; // 10 بُعد
export const DEFAULT_BEHAVIOR_WEIGHTS = [1, 1, 1, 1, 1]; // 5 بُعد
export const DEFAULT_PERSONALITY_WEIGHTS = [1, 1, 1, 1, 1]; // 5 بُعد

// ─── Refresh ─────────────────────────────────────────────────────────────────

/** تعداد کاربرانی که به‌صورت موازی در یک batch پردازش می‌شوند */
export const REFRESH_CONCURRENCY = 10;

/** TTL کش feature snapshot در Redis (ثانیه) */
export const FEATURE_CACHE_TTL = 300;

/** TTL قفل Cron در Redis (ثانیه) */
export const CRON_LOCK_TTL = 300;

// ─── Preference Learning ──────────────────────────────────────────────────────

/** نرخ یادگیری برای آپدیت preferenceVector */
export const PREFERENCE_LEARNING_RATE = 0.1;

/** ضریب فراموشی (decay) برای preferenceVector قدیمی */
export const PREFERENCE_DECAY = 0.95;

// ─── Geo Normalization ────────────────────────────────────────────────────────

/** محدوده lat ایران */
export const GEO_LAT = { min: 25, max: 40 };

/** محدوده lng ایران */
export const GEO_LNG = { min: 44, max: 64 };
