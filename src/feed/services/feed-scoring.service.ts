import { Injectable } from '@nestjs/common';

export type CandidateSource = 'boost' | 'vip' | 'credit' | 'suggestion';

export interface ScoredCandidate {
  priority?: number;
  boostActive?: boolean;
  trustScore?: number;
  /**
   * اگر pre-calculated باشد (از SuggestionService)
   * از این استفاده می‌کنیم تا دو بار محاسبه نشود.
   */
  trustMultiplier?: number;
  /**
   * فقط برای boost/vip/credit از feed-candidate می‌آید.
   * برای suggestion ها freshnessBoost قبلاً در compatibilityScore بافته شده.
   */
  freshnessBoost?: number;
  phase?: string;
  expectedRevenue?: number;
}

@Injectable()
export class FeedScoringService {
  assignPriority(
    source: CandidateSource,
    candidate?: ScoredCandidate,
    /**
     * برای suggestions: compatibilityScore / 100
     * این مقدار قبلاً rawRevenue × freshnessBoost است.
     * پس freshnessBoost را دوباره اعمال نمی‌کنیم.
     */
    suggestionScore?: number,
  ): number {
    const base = this.getBaseScore(source, suggestionScore);
    const quality = this.getQualityMultiplier(source, candidate);
    return Math.round(base * quality);
  }

  /** backward compatibility */
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
      case 'boost':
        return 100;
      case 'vip':
        return 80;
      case 'credit':
        return 60;
      case 'suggestion':
        // suggestionScore = rawRevenue × freshnessBoost (قبلاً اعمال شده)
        return suggestionScore != null
          ? Math.max(10, Math.min(59, suggestionScore * 100))
          : 40;
      default:
        return 40;
    }
  }

  private getQualityMultiplier(
    source: CandidateSource,
    candidate?: ScoredCandidate,
  ): number {
    if (!candidate) return 1.0;

    let multiplier = 1.0;

    // ── Trust re-ranking ──
    // از pre-calculated استفاده می‌کنیم اگر موجود باشد
    const trustMult =
      candidate.trustMultiplier ??
      0.7 + ((candidate.trustScore ?? 50) / 100) * 0.6;
    multiplier *= trustMult;

    // ── Freshness boost ──
    // فقط برای boost/vip/credit اعمال می‌شود.
    // برای suggestion ها freshnessBoost قبلاً در base score است.
    if (source !== 'suggestion' && candidate.freshnessBoost !== undefined) {
      multiplier *= candidate.freshnessBoost;
    }

    // ── Phase bonus ──
    const phaseBonus: Record<string, number> = {
      hot: 1.2,
      warm: 1.0,
      cold: 0.85,
    };
    multiplier *= phaseBonus[candidate.phase ?? 'cold'] ?? 1.0;

    // boost فعال: جلوگیری از دوبار حساب کردن
    if (candidate.boostActive && candidate.phase !== 'hot') {
      multiplier *= 1.1;
    }

    return Math.max(0.5, Math.min(2.0, multiplier));
  }

  sortByPriority<T extends { priority?: number }>(items: T[]): T[] {
    return [...items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }
}
