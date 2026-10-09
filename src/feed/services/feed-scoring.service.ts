import { Injectable } from '@nestjs/common';

export type CandidateSource = 'boost' | 'vip' | 'credit' | 'suggestion';

export interface ScoredCandidate {
  priority?: number;
  boostActive?: boolean;
  trustScore?: number;
  trustMultiplier?: number;
  freshnessBoost?: number;
  phase?: string;
  intelligenceScore?: number;
  intelligenceConfidence?: number;
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

    return Math.round(this.clamp(base * multiplier, 0, 100));
  }

  /**
   * سازگاری با فراخوانی‌های قدیمی.
   */
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
        // suggestionScore همیشه باید در بازه 0..1 باشد.
        const compatibility = this.clamp(suggestionScore ?? 0.4, 0, 1);

        // بازه پیشنهادهای هوش مصنوعی: 30..90
        return 30 + compatibility * 60;
      }

      // مزیت تجاری محدود است و سازگاری واقعی را جایگزین نمی‌کند.
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
    if (!candidate) {
      return 1;
    }

    let multiplier = 1;

    const trustMultiplier =
      candidate.trustMultiplier ??
      0.7 + (this.clamp(candidate.trustScore ?? 50, 0, 100) / 100) * 0.3;

    multiplier *= this.clamp(trustMultiplier, 0.7, 1.15);

    // تازگی برای پیشنهادهای AI قبلاً در مرحله پیشنهاد اعمال شده است.
    if (source !== 'suggestion' && candidate.freshnessBoost !== undefined) {
      multiplier *= this.clamp(candidate.freshnessBoost, 0.85, 1.1);
    }

    const phaseMultipliers: Record<string, number> = {
      cold: 0.97,
      warm: 1,
      hot: 1.03,
    };

    multiplier *= phaseMultipliers[candidate.phase ?? 'cold'] ?? 1;

    // Confidence فقط یک تعدیل بسیار کوچک است.
    if (
      source === 'suggestion' &&
      candidate.intelligenceConfidence !== undefined
    ) {
      const confidence = this.clamp(candidate.intelligenceConfidence, 0, 1);

      multiplier *= 0.97 + confidence * 0.03;
    }

    // درآمد، خرید، Boost و VIP حق ندارند سازگاری را دور بزنند.
    return this.clamp(multiplier, 0.75, 1.2);
  }

  sortByPriority<T extends { priority?: number }>(items: T[]): T[] {
    return [...items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }

    return Math.max(min, Math.min(max, value));
  }
}
