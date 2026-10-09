import { Injectable } from '@nestjs/common';

export type CandidateSource = 'boost' | 'vip' | 'credit' | 'suggestion';

export interface ScoredCandidate {
  priority?: number;
  boostActive?: boolean;
  trustScore?: number;
  trustMultiplier?: number;
  freshnessBoost?: number;
  phase?: string;

  /** امتیاز سازگاری رابطه‌ای در بازه 0..1 */
  intelligenceScore?: number;

  /** confidence مدل در بازه 0..1 */
  intelligenceConfidence?: number;

  /** سیگنال تجاری؛ هرگز جایگزین سازگاری نیست */
  expectedRevenue?: number;
}

@Injectable()
export class FeedScoringService {
  assignPriority(
    source: CandidateSource,
    candidate?: ScoredCandidate,
    suggestionScore?: number,
  ): number {
    const base = this.getBaseScore(source, suggestionScore);
    const multiplier = this.getQualityMultiplier(source, candidate);

    return Math.round(Math.max(0, Math.min(100, base * multiplier)));
  }

  /** سازگاری با فراخوانی‌های قدیمی */
  assignPriorityBySource(
    source: CandidateSource,
    suggestionScore?: number,
  ): number {
    return this.assignPriority(source, undefined, suggestionScore);
  }

  private getBaseScore(
    source: CandidateSource,
    suggestionScore?: number,
  ): number {
    switch (source) {
      case 'suggestion': {
        /*
         * suggestionScore is compatibilityScore / 100.
         * A good relationship match should outrank commercial placement.
         */
        const compatibility = this.clamp(suggestionScore ?? 0.4, 0, 1);
        return 30 + compatibility * 60;
      }

      /*
       * Commercial source changes are intentionally small.
       * These users still need to pass the same hard filters.
       */
      case 'boost':
        return 43;
      case 'vip':
        return 42;
      case 'credit':
        return 41;
      default:
        return 40;
    }
  }

  private getQualityMultiplier(
    source: CandidateSource,
    candidate?: ScoredCandidate,
  ): number {
    if (!candidate) return 1;

    let multiplier = 1;

    const trustMultiplier =
      candidate.trustMultiplier ??
      0.7 + (this.clamp(candidate.trustScore ?? 50, 0, 100) / 100) * 0.3;

    multiplier *= this.clamp(trustMultiplier, 0.7, 1.15);

    /*
     * Suggestions already include freshness in their display score.
     * Apply freshness here only to the non-suggestion candidates.
     */
    if (source !== 'suggestion' && candidate.freshnessBoost !== undefined) {
      multiplier *= this.clamp(candidate.freshnessBoost, 0.85, 1.1);
    }

    const phaseMultiplier: Record<string, number> = {
      hot: 1.03,
      warm: 1,
      cold: 0.97,
    };

    multiplier *= phaseMultiplier[candidate.phase ?? 'cold'] ?? 1;

    /*
     * Small bounded confidence adjustment:
     * uncertainty cannot create a large ranking advantage.
     */
    if (
      source === 'suggestion' &&
      candidate.intelligenceConfidence !== undefined
    ) {
      const confidence = this.clamp(candidate.intelligenceConfidence, 0, 1);
      multiplier *= 0.97 + confidence * 0.03;
    }

    /*
     * No separate Boost/VIP/credit multiplier here.
     * Their influence is represented by the small source-base difference.
     */
    return this.clamp(multiplier, 0.75, 1.2);
  }

  sortByPriority<T extends { priority?: number }>(items: T[]): T[] {
    return [...items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }
}
