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
        const compatibility = this.clamp(suggestionScore ?? 0.4, 0, 1);

        // سازگاری رابطه‌ای مهم‌ترین عامل پایه برای پیشنهاد AI است.
        return 30 + compatibility * 60;
      }
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

    const trustScore = this.clamp(candidate.trustScore ?? 50, 0, 100);
    const calculatedTrustMultiplier = 0.7 + (trustScore / 100) * 0.3;
    const trustMultiplier = this.clamp(
      candidate.trustMultiplier ?? calculatedTrustMultiplier,
      0.7,
      1.15,
    );

    multiplier *= trustMultiplier;

    // تازگی در پیشنهاد AI از قبل محاسبه شده است.
    if (source !== 'suggestion' && candidate.freshnessBoost !== undefined) {
      multiplier *= this.clamp(candidate.freshnessBoost, 0.85, 1.1);
    }

    const phaseMultipliers: Record<string, number> = {
      cold: 0.97,
      warm: 1,
      hot: 1.03,
    };

    multiplier *= phaseMultipliers[candidate.phase ?? 'cold'] ?? 1;

    if (
      source === 'suggestion' &&
      candidate.intelligenceConfidence !== undefined
    ) {
      const confidence = this.clamp(candidate.intelligenceConfidence, 0, 1);

      // Confidence فقط اصلاح کوچک است، نه جایگزین سازگاری.
      multiplier *= 0.97 + confidence * 0.03;
    }

    /*
     * expectedRevenue عمداً امتیاز سازگاری را بالا نمی‌برد.
     * اولویت تجاری نباید به‌تنهایی جایگزین کیفیت پیشنهاد شود.
     */
    return this.clamp(multiplier, 0.75, 1.2);
  }

  sortByPriority<T extends { priority?: number }>(items: T[]): T[] {
    // Sort پایدار: در تساوی، ترتیب ورودی حفظ می‌شود.
    return items
      .map((item, index) => ({
        item,
        index,
        priority: this.safePriority(item.priority),
      }))
      .sort((a, b) => b.priority - a.priority || a.index - b.index)
      .map(({ item }) => item);
  }

  private safePriority(value?: number): number {
    return Number.isFinite(value) ? value! : 0;
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }
}
