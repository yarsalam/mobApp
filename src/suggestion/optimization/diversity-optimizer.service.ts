import { Injectable } from '@nestjs/common';
import { FeatureStoreService } from 'src/feature-store/feature-store.service';

interface ScoredItem {
  id: string | number;
  score: number;
}

@Injectable()
export class DiversityOptimizerService {
  constructor(private readonly featureStore: FeatureStoreService) {}

  /**
   * Maximal Marginal Relevance
   *
   * هدف:
   *
   * relevance
   *     +
   * diversity
   *
   * یعنی:
   *
   * candidate خوب باشد،
   * ولی اگر پنج candidate قبلی تقریباً
   * همان representation را دارند،
   * candidate متفاوت‌تر ترجیح داده شود.
   *
   * Representation:
   *
   * profile      10
   * preference   10
   * behavior      5
   * personality  5
   * geo           2
   *
   * مجموع = 32D
   */
  async optimizeWithMMR(
    items: ScoredItem[],
    limit: number,
    lambda = 0.72,
  ): Promise<ScoredItem[]> {
    if (items.length === 0) {
      return [];
    }

    const safeLimit = Math.max(1, Math.min(limit, items.length));

    if (items.length <= safeLimit) {
      return [...items];
    }

    const safeLambda = Math.max(0.5, Math.min(0.95, lambda));

    // ─────────────────────────────────────────────────────────────
    // Batch feature loading
    // ─────────────────────────────────────────────────────────────

    const ids = [
      ...new Set(
        items
          .map((item) => Number(item.id))
          .filter((id) => Number.isFinite(id)),
      ),
    ];

    const featuresMap = await this.featureStore.getBatchFeatures(ids);

    // ─────────────────────────────────────────────────────────────
    // ساخت representation کامل
    // ─────────────────────────────────────────────────────────────

    const vectors = new Map<number, number[]>();

    for (const id of ids) {
      const snapshot = featuresMap.get(id);

      if (!snapshot) {
        vectors.set(id, []);
        continue;
      }

      vectors.set(id, this.buildRepresentation(snapshot));
    }

    // ─────────────────────────────────────────────────────────────
    // Ranking
    // ─────────────────────────────────────────────────────────────

    const rankedItems = [...items].sort((a, b) => b.score - a.score);

    const selected: ScoredItem[] = [];

    const remaining = [...rankedItems];

    // اولین candidate:
    // بیشترین relevance
    const first = remaining.shift();

    if (!first) {
      return [];
    }

    selected.push(first);

    // ─────────────────────────────────────────────────────────────
    // MMR loop
    // ─────────────────────────────────────────────────────────────

    while (selected.length < safeLimit && remaining.length > 0) {
      let bestIndex = -1;
      let bestMMR = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];

        const candidateId = Number(candidate.id);

        const candidateVector = vectors.get(candidateId) ?? [];

        // ─────────────────────────────────────────
        // Relevance
        // ─────────────────────────────────────────

        const relevance = this.normalizeScore(candidate.score, rankedItems);

        // ─────────────────────────────────────────
        // Maximum similarity with selected
        // ─────────────────────────────────────────

        let maxSimilarity = 0;

        for (const selectedItem of selected) {
          const selectedVector = vectors.get(Number(selectedItem.id)) ?? [];

          const similarity = this.cosineSimilarity(
            candidateVector,
            selectedVector,
          );

          maxSimilarity = Math.max(maxSimilarity, similarity);
        }

        // ─────────────────────────────────────────
        // Diversity
        // ─────────────────────────────────────────

        const diversity = 1 - maxSimilarity;

        // ─────────────────────────────────────────
        // MMR
        // ─────────────────────────────────────────

        const mmr = safeLambda * relevance + (1 - safeLambda) * diversity;

        if (mmr > bestMMR) {
          bestMMR = mmr;
          bestIndex = i;
        }
      }

      if (bestIndex === -1) {
        break;
      }

      selected.push(remaining[bestIndex]);

      remaining.splice(bestIndex, 1);
    }

    return selected;
  }

  /**
   * Representation کامل 32D.
   *
   * نکته:
   * اینجا دوباره وزن‌دهی انجام نمی‌دهیم.
   * FeatureStore/Qdrant مسئول representation اصلی است.
   *
   * MMR فقط برای اندازه‌گیری شباهت
   * از feature representation استفاده می‌کند.
   */
  private buildRepresentation(snapshot: {
    profileVector?: number[];
    preferenceVector?: number[];
    behaviorVector?: number[];
    personalityVector?: number[];
    geoVector?: number[];
  }): number[] {
    const profile = this.normalizeVector(snapshot.profileVector, 10);

    const preference = this.normalizeVector(
      snapshot.preferenceVector?.length
        ? snapshot.preferenceVector
        : snapshot.profileVector,
      10,
    );

    const behavior = this.normalizeVector(snapshot.behaviorVector, 5);

    const personality = this.normalizeVector(snapshot.personalityVector, 5);

    const geo = this.normalizeVector(snapshot.geoVector, 2);

    return [...profile, ...preference, ...behavior, ...personality, ...geo];
  }

  /**
   * نرمال‌سازی relevance بین 0 و 1.
   */
  private normalizeScore(score: number, items: ScoredItem[]): number {
    if (!items.length) {
      return 0;
    }

    const max = Math.max(
      ...items.map((item) => (Number.isFinite(item.score) ? item.score : 0)),
    );

    const min = Math.min(
      ...items.map((item) => (Number.isFinite(item.score) ? item.score : 0)),
    );

    if (max === min) {
      return 1;
    }

    return Math.max(0, Math.min(1, (score - min) / (max - min)));
  }

  /**
   * Adaptive exploration.
   *
   * کاربر جدید:
   * exploration بیشتر
   *
   * کاربر mature:
   * exploitation بیشتر
   */
  getAdaptiveEpsilon(userInteractions: number): number {
    const count = Math.max(0, userInteractions);

    if (count < 10) {
      return 0.3;
    }

    if (count < 50) {
      return 0.15;
    }

    if (count < 200) {
      return 0.08;
    }

    return 0.04;
  }

  /**
   * Exploration کنترل‌شده.
   *
   * random shuffle کامل باعث می‌شود
   * quality candidateها کاملاً از بین برود.
   *
   * بنابراین فقط top portion را
   * کمی جابه‌جا می‌کنیم.
   */
  exploreExploit<T extends { score: number }>(items: T[]): T[] {
    if (items.length <= 2) {
      return [...items];
    }

    const sorted = [...items].sort((a, b) => b.score - a.score);

    const explorationWindow = Math.max(
      2,
      Math.min(10, Math.ceil(sorted.length * 0.2)),
    );

    const head = sorted.slice(0, explorationWindow);

    const tail = sorted.slice(explorationWindow);

    // Fisher-Yates
    for (let i = head.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));

      [head[i], head[j]] = [head[j], head[i]];
    }

    return [...head, ...tail];
  }

  /**
   * Cosine similarity
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || !b.length) {
      return 0;
    }

    const length = Math.min(a.length, b.length);

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < length; i++) {
      const av = Number.isFinite(a[i]) ? a[i] : 0;

      const bv = Number.isFinite(b[i]) ? b[i] : 0;

      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);

    if (denominator === 0) {
      return 0;
    }

    return Math.max(-1, Math.min(1, dot / denominator));
  }

  private normalizeVector(
    vector: number[] | undefined,
    dimension: number,
  ): number[] {
    const result = (vector ?? [])
      .slice(0, dimension)
      .map((value) => (Number.isFinite(value) ? value : 0));

    while (result.length < dimension) {
      result.push(0);
    }

    return result;
  }
}
