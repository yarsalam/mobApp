export const CACHE_KEY_PREFIX = 'feature_snapshot';

export const QDRANT_COLLECTION = 'user_vectors';

// ─────────────────────────────────────────────────────────────
// Vector dimensions
// ─────────────────────────────────────────────────────────────

export const VECTOR_DIMS = {
  profile: 10,

  /**
   * Canonical preference vector.
   *
   * این vector از ترکیب positive و negative ساخته می‌شود.
   */
  preference: 10,

  behavior: 5,
  personality: 5,
  geo: 2,

  get total() {
    return (
      this.profile +
      this.preference +
      this.behavior +
      this.personality +
      this.geo
    );
  },
} as const;

export const SEMANTIC_VECTOR_DIMS = 384;
// ─────────────────────────────────────────────────────────────
// Segment weights
// ─────────────────────────────────────────────────────────────

export const SEGMENT_WEIGHTS = {
  profile: Math.sqrt(0.3),

  // Preference مهم‌ترین بخش یادگیری است.
  preference: Math.sqrt(0.35),

  behavior: Math.sqrt(0.2),
  personality: Math.sqrt(0.1),
  geo: Math.sqrt(0.05),
} as const;

// ─────────────────────────────────────────────────────────────
// Feature weights
// ─────────────────────────────────────────────────────────────

export const DEFAULT_PROFILE_WEIGHTS = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

export const DEFAULT_BEHAVIOR_WEIGHTS = [1, 1, 1, 1, 1];

export const DEFAULT_PERSONALITY_WEIGHTS = [1, 1, 1, 1, 1];

// ─────────────────────────────────────────────────────────────
// Refresh
// ─────────────────────────────────────────────────────────────

export const REFRESH_CONCURRENCY = 10;

export const FEATURE_CACHE_TTL = 300;

export const CRON_LOCK_TTL = 300;

// ─────────────────────────────────────────────────────────────
// Preference learning
// ─────────────────────────────────────────────────────────────

/**
 * سرعت یادگیری.
 */
export const PREFERENCE_LEARNING_RATE = 0.1;

/**
 * حافظه قدیمی.
 */
export const PREFERENCE_DECAY = 0.95;

/**
 * حداکثر contribution هر signal.
 */
export const MAX_PREFERENCE_SIGNAL = 1;

/**
 * وزن signalهای مختلف.
 */
export const PREFERENCE_SIGNAL_WEIGHTS = {
  like: 0.5,
  superlike: 0.9,
  match: 1.0,

  skip: 0.35,
  block: 1.0,
  report: 1.0,
} as const;

// ─────────────────────────────────────────────────────────────
// Geo
// ─────────────────────────────────────────────────────────────

export const GEO_LAT = {
  min: 25,
  max: 40,
};

export const GEO_LNG = {
  min: 44,
  max: 64,
};

export const QDRANT_SEMANTIC_COLLECTION = 'user_semantic_vectors_384';
