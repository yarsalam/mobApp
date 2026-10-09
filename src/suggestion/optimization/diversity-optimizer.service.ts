import { Injectable } from '@nestjs/common';
import { FeatureStoreService } from 'src/feature-store/feature-store.service';

interface ScoredItem {
  id: string | number;
  score: number;
}

interface FeatureRepresentation {
  vector: number[];
  available: boolean;
}

@Injectable()
export class DiversityOptimizerService {
  constructor(private readonly featureStore: FeatureStoreService) {}

  async optimizeWithMMR(
    items: ScoredItem[],
    limit: number,
    lambda = 0.72,
  ): Promise<ScoredItem[]> {
    const safeItems = this.sanitizeItems(items);

    if (safeItems.length === 0 || limit <= 0) {
      return [];
    }

    const safeLimit = Math.min(Math.floor(limit), safeItems.length);

    const rankedItems = [...safeItems].sort((a, b) => b.score - a.score);

    if (rankedItems.length <= safeLimit) {
      return rankedItems;
    }

    const safeLambda = this.clamp(lambda, 0.5, 0.95);

    const ids = [
      ...new Set(
        rankedItems
          .map((item) => Number(item.id))
          .filter((id) => Number.isSafeInteger(id) && id > 0),
      ),
    ];

    const featuresMap = await this.featureStore.getBatchFeatures(ids);

    const representations = new Map<number, FeatureRepresentation>();

    for (const id of ids) {
      const snapshot = featuresMap.get(id);

      if (!snapshot) {
        representations.set(id, {
          vector: [],
          available: false,
        });
        continue;
      }

      const vector = this.buildRepresentation(snapshot);

      const available = vector.some((value) => value !== 0);

      representations.set(id, {
        vector,
        available,
      });
    }

    const selected: ScoredItem[] = [];
    const remaining = [...rankedItems];

    // اولین انتخاب بر اساس بالاترین relevance است.
    const first = remaining.shift();

    if (!first) {
      return [];
    }

    selected.push(first);

    while (selected.length < safeLimit && remaining.length > 0) {
      let bestIndex = -1;
      let bestMMR = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const candidateId = Number(candidate.id);
        const candidateRepresentation = representations.get(candidateId);

        const relevance = this.normalizeScore(candidate.score, rankedItems);

        let maxSimilarity = 0;

        /*
         * اگر ویژگی‌های یکی از دو کاربر موجود نباشد،
         * شباهت را صفر فرض نمی‌کنیم که تنوع مصنوعی ایجاد شود؛
         * برای آن مقایسه از مقدار خنثی استفاده می‌کنیم.
         */
        for (const selectedItem of selected) {
          const selectedRepresentation = representations.get(
            Number(selectedItem.id),
          );

          if (
            !candidateRepresentation?.available ||
            !selectedRepresentation?.available
          ) {
            maxSimilarity = Math.max(maxSimilarity, 0.5);
            continue;
          }

          const similarity = this.cosineSimilarity(
            candidateRepresentation.vector,
            selectedRepresentation.vector,
          );

          maxSimilarity = Math.max(maxSimilarity, similarity);
        }

        const diversity = 1 - maxSimilarity;

        const mmr = safeLambda * relevance + (1 - safeLambda) * diversity;

        if (mmr > bestMMR) {
          bestMMR = mmr;
          bestIndex = i;
        }
      }

      if (bestIndex < 0) {
        break;
      }

      selected.push(remaining[bestIndex]);
      remaining.splice(bestIndex, 1);
    }

    return selected;
  }

  getAdaptiveEpsilon(userInteractions: number): number {
    const count = Math.max(
      0,
      Number.isFinite(userInteractions) ? userInteractions : 0,
    );

    if (count < 10) return 0.3;
    if (count < 50) return 0.15;
    if (count < 200) return 0.08;

    return 0.04;
  }

  exploreExploit<T extends { score: number }>(items: T[]): T[] {
    const sorted = [...items].sort(
      (a, b) => this.safeScore(b.score) - this.safeScore(a.score),
    );

    if (sorted.length <= 2) {
      return sorted;
    }

    const explorationWindow = Math.max(
      2,
      Math.min(10, Math.ceil(sorted.length * 0.2)),
    );

    const head = sorted.slice(0, explorationWindow);
    const tail = sorted.slice(explorationWindow);

    // Fisher-Yates: بدون sort تصادفی و رفتار غیرقابل‌اتکا.
    for (let i = head.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [head[i], head[j]] = [head[j], head[i]];
    }

    return [...head, ...tail];
  }

  private sanitizeItems(items: ScoredItem[]): ScoredItem[] {
    const seen = new Set<number>();
    const result: ScoredItem[] = [];

    for (const item of items ?? []) {
      const id = Number(item?.id);
      const score = Number(item?.score);

      if (!Number.isSafeInteger(id) || id <= 0) continue;
      if (!Number.isFinite(score)) continue;
      if (seen.has(id)) continue;

      seen.add(id);
      result.push({ id, score });
    }

    return result;
  }

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

  private normalizeScore(score: number, items: ScoredItem[]): number {
    if (items.length === 0) return 0;

    const scores = items.map((item) => this.safeScore(item.score));
    const max = Math.max(...scores);
    const min = Math.min(...scores);

    if (max === min) return 1;

    return this.clamp((this.safeScore(score) - min) / (max - min), 0, 1);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || !b.length || a.length !== b.length) {
      return 0.5;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const av = Number.isFinite(a[i]) ? a[i] : 0;
      const bv = Number.isFinite(b[i]) ? b[i] : 0;

      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);

    if (denominator === 0) return 0.5;

    // شباهت برای MMR در بازه 0..1 قرار می‌گیرد.
    const cosine = dot / denominator;

    return this.clamp((cosine + 1) / 2, 0, 1);
  }

  private normalizeVector(
    vector: number[] | undefined,
    dimension: number,
  ): number[] {
    const result = (Array.isArray(vector) ? vector : [])
      .slice(0, dimension)
      .map((value) => (Number.isFinite(value) ? value : 0));

    while (result.length < dimension) {
      result.push(0);
    }

    return result;
  }

  private safeScore(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;

    return Math.max(min, Math.min(max, value));
  }
}
