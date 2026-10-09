import { Injectable } from '@nestjs/common';

export type CandidateSource = 'boost' | 'vip' | 'credit' | 'suggestion';

export interface ScoredCandidate {
  priority?: number;

  boostActive?: boolean;

  trustScore?: number;

  trustMultiplier?: number;

  freshnessBoost?: number;

  phase?: string;

  expectedRevenue?: number;

  /**
   * امتیاز اصلی Intelligence.
   * بین 0 و 1.
   */
  intelligenceScore?: number;

  /**
   * compatibility خام.
   * بین 0 و 1.
   */
  compatibilityScore?: number;

  /**
   * confidence مدل.
   */
  intelligenceConfidence?: number;
}

@Injectable()
export class FeedScoringService {
  /**
   * امتیاز نهایی candidate برای Feed.
   *
   * اصل معماری:
   *
   * Intelligence
   *      ↓
   * Trust
   *      ↓
   * Freshness
   *      ↓
   * Business modifier
   *
   * نه:
   *
   * Boost > AI
   */
  assignPriority(
    source: CandidateSource,
    candidate?: ScoredCandidate,
    suggestionScore?: number,
  ): number {
    const intelligence = this.getIntelligenceScore(
      source,
      candidate,
      suggestionScore,
    );

    const quality = this.getQualityMultiplier(source, candidate);

    const business = this.getBusinessModifier(source, candidate);

    const finalScore = intelligence * quality * business;

    return Math.round(Math.max(1, Math.min(100, finalScore * 100)));
  }

  /**
   * backward compatibility
   */
  assignPriorityBySource(
    source: CandidateSource,
    suggestionScore?: number,
  ): number {
    return this.assignPriority(source, undefined, suggestionScore);
  }

  /**
   * Intelligence score پایه.
   */
  private getIntelligenceScore(
    source: CandidateSource,
    candidate?: ScoredCandidate,
    suggestionScore?: number,
  ): number {
    if (!candidate) {
      return this.defaultSourceScore(source, suggestionScore);
    }

    if (candidate.intelligenceScore != null) {
      return this.clamp01(candidate.intelligenceScore);
    }

    if (candidate.compatibilityScore != null) {
      return this.clamp01(candidate.compatibilityScore);
    }

    if (source === 'suggestion' && suggestionScore != null) {
      return this.clamp01(suggestionScore);
    }

    return this.defaultSourceScore(source, suggestionScore);
  }

  /**
   * کیفیت واقعی candidate.
   *
   * Trust و freshness اینجا اعمال می‌شوند.
   */
  private getQualityMultiplier(
    source: CandidateSource,
    candidate?: ScoredCandidate,
  ): number {
    if (!candidate) {
      return 1;
    }

    let multiplier = 1;

    // ─────────────────────────────────────────
    // Trust
    // ─────────────────────────────────────────

    const trustMultiplier =
      candidate.trustMultiplier ??
      this.calculateTrustMultiplier(candidate.trustScore ?? 50);

    multiplier *= trustMultiplier;

    // ─────────────────────────────────────────
    // Freshness
    // ─────────────────────────────────────────

    if (candidate.freshnessBoost != null) {
      multiplier *= this.clamp(candidate.freshnessBoost, 0.85, 1.2);
    }

    // ─────────────────────────────────────────
    // Phase
    // ─────────────────────────────────────────

    const phaseBonus: Record<string, number> = {
      hot: 1.08,
      warm: 1.0,
      cold: 0.94,
    };

    multiplier *= phaseBonus[candidate.phase ?? 'cold'] ?? 1;

    // ─────────────────────────────────────────
    // Confidence
    // ─────────────────────────────────────────

    if (candidate.intelligenceConfidence != null) {
      const confidence = this.clamp01(candidate.intelligenceConfidence);

      /**
       * confidence پایین نباید
       * candidate را حذف کند؛
       * فقط کمی uncertainty penalty.
       */
      multiplier *= 0.9 + confidence * 0.1;
    }

    return this.clamp(multiplier, 0.65, 1.3);
  }

  /**
   * Business modifiers.
   *
   * Boost/VIP/credit می‌توانند visibility
   * را کمی بالا ببرند،
   * ولی نباید compatibility را override کنند.
   */
  private getBusinessModifier(
    source: CandidateSource,
    candidate?: ScoredCandidate,
  ): number {
    let modifier = 1;

    switch (source) {
      case 'boost':
        modifier *= 1.08;
        break;

      case 'vip':
        modifier *= 1.04;
        break;

      case 'credit':
        modifier *= 1.02;
        break;

      case 'suggestion':
        modifier *= 1.0;
        break;
    }

    // Revenue فقط یک signal کوچک.
    if (candidate?.expectedRevenue != null && candidate.expectedRevenue > 0) {
      modifier *= 1 + Math.min(0.05, candidate.expectedRevenue * 0.02);
    }

    // boostActive را دوباره شدیداً حساب نکن.
    if (candidate?.boostActive && source === 'boost') {
      modifier *= 1.03;
    }

    return this.clamp(modifier, 0.95, 1.2);
  }

  /**
   * fallback فقط زمانی که candidate
   * هنوز intelligence metadata ندارد.
   */
  private defaultSourceScore(
    source: CandidateSource,
    suggestionScore?: number,
  ): number {
    switch (source) {
      case 'suggestion':
        return this.clamp01(suggestionScore ?? 0.5);

      case 'boost':
        return 0.75;

      case 'vip':
        return 0.7;

      case 'credit':
        return 0.65;

      default:
        return 0.5;
    }
  }

  private calculateTrustMultiplier(trustScore: number): number {
    const normalized = this.clamp(trustScore, 0, 100) / 100;

    return 0.75 + normalized * 0.5;
  }

  private clamp01(value: number): number {
    return this.clamp(value, 0, 1);
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }

    return Math.max(min, Math.min(max, value));
  }

  sortByPriority<T extends { priority?: number }>(items: T[]): T[] {
    return [...items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }
}
