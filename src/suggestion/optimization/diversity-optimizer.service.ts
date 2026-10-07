// import { Injectable } from '@nestjs/common';
// import { RevenueScore } from '../scoring/revenue-scorer.service';
// import { FeatureStoreService } from 'src/feature-store/feature-store.service';

// interface ScoredItem {
//   // تعریف اینترفیس ScoredItem (اگر ندارید اضافه کنید)
//   id: string | number;
//   score: number;
//   // بقیه فیلدها...
// }

// @Injectable()
// export class DiversityOptimizerService {
//   constructor(private readonly featureStore: FeatureStoreService) {}
//   /**
//    * MMR-based optimization for diversity + relevance
//    */
//   async optimizeWithMMR(
//     items: ScoredItem[],
//     limit: number,
//     lambda = 0.7,
//   ): Promise<ScoredItem[]> {
//     if (items.length <= limit) return items;

//     const selected: ScoredItem[] = [];
//     const remaining = [...items];

//     // اولین مورد: بیشترین expected revenue
//     selected.push(remaining.shift()!);

//     while (selected.length < limit && remaining.length > 0) {
//       let bestIdx = -1;
//       let bestScore = -Infinity;

//       for (let i = 0; i < remaining.length; i++) {
//         const item = remaining[i];

//         // relevance = expected revenue (نرمالایز)
//         const maxRevenue = items[0].score;
//         const relevance = item.score / maxRevenue;

//         // diversity = 1 - max شباهت با موارد انتخاب شده
//         let maxSimilarity = 0;
//         for (const sel of selected) {
//           const sim = await this.calculateSimilarity(item, sel);
//           maxSimilarity = Math.max(maxSimilarity, sim);
//         }
//         const diversity = 1 - maxSimilarity;

//         // MMR = λ * relevance + (1-λ) * diversity
//         const mmr = lambda * relevance + (1 - lambda) * diversity;

//         if (mmr > bestScore) {
//           bestScore = mmr;
//           bestIdx = i;
//         }
//       }

//       if (bestIdx !== -1) {
//         selected.push(remaining[bestIdx]);
//         remaining.splice(bestIdx, 1);
//       } else {
//         break;
//       }
//     }

//     return selected;
//   }

//   /**
//    * Adaptive Epsilon (بر اساس تعداد تعاملات کاربر)
//    */
//   getAdaptiveEpsilon(userInteractions: number): number {
//     if (userInteractions < 10) return 0.3; // کاربر جدید: کاوش بیشتر
//     if (userInteractions < 50) return 0.15; // کاربر متوسط
//     if (userInteractions < 200) return 0.08; // کاربر با تجربه
//     return 0.04; // کاربر حرفه‌ای: کاوش کم
//   }

//   // متد calculateSimilarity رو هم باید تعریف کنید (اگر ندارید)
//   // src/suggestion/optimization/diversity-optimizer.service.ts
//   public async calculateSimilarity(
//     itemA: ScoredItem,
//     itemB: ScoredItem,
//   ): Promise<number> {
//     const vecA = await this.featureStore.getProfileVector(Number(itemA.id));
//     const vecB = await this.featureStore.getProfileVector(Number(itemB.id));

//     if (!vecA || !vecB) return 0.5;

//     const dot = vecA.reduce((sum, v, i) => sum + v * (vecB[i] || 0), 0);
//     const normA = Math.sqrt(vecA.reduce((sum, v) => sum + v * v, 0));
//     const normB = Math.sqrt(vecB.reduce((sum, v) => sum + v * v, 0));

//     return normA && normB ? dot / (normA * normB) : 0;
//   }

//   public exploreExploit(items: RevenueScore[]): RevenueScore[] {
//     // مثلاً weighted shuffle
//     return [...items].sort(() => Math.random() - 0.5);
//     // یا پیاده‌سازی واقعی exploration
//   }
// }
// diversity-optimizer.service.ts (نسخه Batch)
import { Injectable } from '@nestjs/common';
import { FeatureStoreService } from 'src/feature-store/feature-store.service';

interface ScoredItem {
  id: string | number;
  score: number;
}

@Injectable()
export class DiversityOptimizerService {
  constructor(private readonly featureStore: FeatureStoreService) {}

  async optimizeWithMMR(
    items: ScoredItem[],
    limit: number,
    lambda = 0.7,
  ): Promise<ScoredItem[]> {
    if (items.length <= limit) return items;

    // یکبار همه بردارها را واکشی کن
    const ids = items.map((it) => Number(it.id));
    const featuresMap = await this.featureStore.getBatchFeatures(ids);
    const vectors = new Map<number, number[]>();
    featuresMap.forEach((snapshot, userId) => {
      vectors.set(
        userId,
        snapshot.preferenceVector || snapshot.profileVector || [],
      );
    });

    const selected: ScoredItem[] = [];
    const remaining = [...items];
    selected.push(remaining.shift()!);

    while (selected.length < limit && remaining.length > 0) {
      let bestIdx = -1,
        bestScore = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const item = remaining[i];
        const itemId = Number(item.id);
        const itemVec = vectors.get(itemId) ?? [];
        const maxRevenue = items[0].score;
        const relevance = item.score / maxRevenue;

        let maxSim = 0;
        for (const sel of selected) {
          const selVec = vectors.get(Number(sel.id)) ?? [];
          const sim = this.cosineSimilarity(itemVec, selVec);
          maxSim = Math.max(maxSim, sim);
        }
        const diversity = 1 - maxSim;
        const mmr = lambda * relevance + (1 - lambda) * diversity;
        if (mmr > bestScore) {
          bestScore = mmr;
          bestIdx = i;
        }
      }
      if (bestIdx !== -1) {
        selected.push(remaining[bestIdx]);
        remaining.splice(bestIdx, 1);
      } else break;
    }
    return selected;
  }

  getAdaptiveEpsilon(userInteractions: number): number {
    if (userInteractions < 10) return 0.3; // کاربر جدید: کاوش بیشتر
    if (userInteractions < 50) return 0.15; // کاربر متوسط
    if (userInteractions < 200) return 0.08; // کاربر با تجربه
    return 0.04; // کاربر حرفه‌ای: کاوش کم
  }
  exploreExploit(items: any[]): any[] {
    return [...items].sort(() => Math.random() - 0.5);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || b.length === 0) return 0.5;
    let dot = 0,
      normA = 0,
      normB = 0;
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const av = a[i] ?? 0,
        bv = b[i] ?? 0;
      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom ? dot / denom : 0;
  }
}
