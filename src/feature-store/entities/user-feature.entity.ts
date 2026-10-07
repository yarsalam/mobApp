import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_feature_snapshots')
export class UserFeatureSnapshot {
  @PrimaryColumn()
  userId: number;

  // ─── Vectors ──────────────────────────────────────────────────────────────

  /** بردار پروفایل ثابت: city, age, bio, hobbies, values, verified, trust, gender, marital, education */
  @Column({ type: 'json', nullable: true })
  profileVector?: number[];

  /**
   * بردار ترجیح یادگرفته‌شده از رفتار کاربر.
   * این بردار از profileVector شروع می‌شود و با هر like/block آپدیت می‌شود.
   * در Qdrant برای Retrieval استفاده می‌شود (نه profileVector).
   */
  @Column({ type: 'json', nullable: true })
  preferenceVector?: number[];

  /** بردار رفتاری: totalEvents, activeDays, purchaseRate, responseRate, matchRate */
  @Column({ type: 'json', nullable: true })
  behaviorVector?: number[];

  /** بردار شخصیتی OCEAN: openness, conscientiousness, extraversion, agreeableness, neuroticism */
  @Column({ type: 'json', nullable: true })
  personalityVector?: number[];

  /** بردار جغرافیایی: lat, lng (normalize شده) */
  @Column({ type: 'json', nullable: true })
  geoVector?: number[];

  // ─── Probabilities ────────────────────────────────────────────────────────

  /** میانگین ارزش طول عمر کاربر */
  @Column({ type: 'float', default: 0 })
  avgLTV: number;

  /** احتمال خرید در 7 روز آینده (0–1) */
  @Column({ type: 'float', default: 0 })
  purchaseProbability: number;

  /** احتمال پاسخ دادن به پیام (0–1) */
  @Column({ type: 'float', default: 0 })
  responseProbability: number;

  /** احتمال تبدیل لایک به مچ (0–1) */
  @Column({ type: 'float', default: 0 })
  matchProbability: number;

  // ─── Phase & Boost ────────────────────────────────────────────────────────

  /** فاز کاربر: cold | warm | hot */
  @Column({ length: 20, default: 'cold' })
  phase: string;

  /** امتیاز فاز (عدد خام) */
  @Column({ type: 'float', default: 0 })
  phaseScore: number;

  /** قدرت boost فعلی (0 = بدون boost) */
  @Column({ type: 'int', default: 0 })
  boostStrength: number;

  /** زمان انقضای boost */
  @Column({ type: 'timestamp', nullable: true })
  boostExpiresAt?: Date;

  // ─── Trust & Activity ─────────────────────────────────────────────────────

  /** امتیاز اعتماد (0–100) - کپی از User.trustScore برای سرعت */
  @Column({ type: 'float', default: 50 })
  trustScore: number;

  /** تعداد روزهای فعال در 7 روز گذشته */
  @Column({ type: 'int', default: 0 })
  retentionDays: number;

  /** آخرین زمان آنلاین بودن */
  @Column({ type: 'timestamp', nullable: true })
  lastSeenAt?: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
