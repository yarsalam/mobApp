import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_feature_snapshots')
export class UserFeatureSnapshot {
  @PrimaryColumn()
  userId: number;

  // ─────────────────────────────────────────────────────────────
  // Profile
  // ─────────────────────────────────────────────────────────────

  @Column({ type: 'json', nullable: true })
  profileVector?: number[];

  // ─────────────────────────────────────────────────────────────
  // Preference Memory
  // ─────────────────────────────────────────────────────────────

  /**
   * Preference قدیمی برای backward compatibility.
   *
   * در نسخه جدید:
   * positivePreferenceVector
   * negativePreferenceVector
   * منابع اصلی learning هستند.
   */
  @Column({ type: 'json', nullable: true })
  preferenceVector?: number[];

  /**
   * چیزهایی که کاربر دوست دارد.
   *
   * LIKE / SUPERLIKE / MATCH
   */
  @Column({ type: 'json', nullable: true })
  positivePreferenceVector?: number[];

  /**
   * چیزهایی که کاربر نمی‌خواهد.
   *
   * SKIP / BLOCK / REPORT
   */
  @Column({ type: 'json', nullable: true })
  negativePreferenceVector?: number[];

  /**
   * تعداد signalهای مثبت.
   *
   * برای confidence مدل استفاده می‌شود.
   */
  @Column({ type: 'int', default: 0 })
  positivePreferenceCount: number;

  /**
   * تعداد signalهای منفی.
   */
  @Column({ type: 'int', default: 0 })
  negativePreferenceCount: number;

  // ─────────────────────────────────────────────────────────────
  // Other feature segments
  // ─────────────────────────────────────────────────────────────

  @Column({ type: 'json', nullable: true })
  behaviorVector?: number[];

  @Column({ type: 'json', nullable: true })
  personalityVector?: number[];

  @Column({ type: 'json', nullable: true })
  geoVector?: number[];

  // ─────────────────────────────────────────────────────────────
  // Probabilities
  // ─────────────────────────────────────────────────────────────

  @Column({ type: 'float', default: 0 })
  avgLTV: number;

  @Column({ type: 'float', default: 0 })
  purchaseProbability: number;

  @Column({ type: 'float', default: 0 })
  responseProbability: number;

  @Column({ type: 'float', default: 0 })
  matchProbability: number;

  // ─────────────────────────────────────────────────────────────
  // Phase / Boost
  // ─────────────────────────────────────────────────────────────

  @Column({ length: 20, default: 'cold' })
  phase: string;

  @Column({ type: 'float', default: 0 })
  phaseScore: number;

  @Column({ type: 'int', default: 0 })
  boostStrength: number;

  @Column({ type: 'timestamp', nullable: true })
  boostExpiresAt?: Date;

  // ─────────────────────────────────────────────────────────────
  // Trust / Activity
  // ─────────────────────────────────────────────────────────────

  @Column({ type: 'float', default: 50 })
  trustScore: number;

  @Column({ type: 'int', default: 0 })
  retentionDays: number;

  @Column({ type: 'timestamp', nullable: true })
  lastSeenAt?: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
