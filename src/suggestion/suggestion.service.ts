import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { InteractionsService } from 'src/interaction/interaction.service';
import { UserEventService } from 'src/user-event/user-event.service';
import { VectorSearchService } from './retrieval/vector-search.service';
import { RevenueScorerService } from './scoring/revenue-scorer.service';
import { DiversityOptimizerService } from './optimization/diversity-optimizer.service';
import { SuggestionEntity } from './entities/suggestion.entity';
import { RelationStatusService } from 'src/relation-status/relation-status.service';
import { EventType } from 'src/user-event/type/event-type.enum';
import { getTargetGender } from 'src/common/utils/gender.util';
import {
  canAppearInFeed,
  calculateFreshnessBoost,
  calculateTrustMultiplier,
} from '../moderation/moderation.utils';

interface ScoreEntry {
  candidateId: number;
  expectedRevenue: number;
}

export interface EnrichedSuggestion {
  id: number;
  nickname: string;
  age: number;
  city?: string;
  gender?: string;
  avatar?: string | null;
  hobbies?: string[];
  values?: string[];
  isOnline?: boolean;
  relation?: any;

  /** امتیاز خالص ML — برای analytics و training data */
  rawRevenue: number;

  /** displayScore = rawRevenue × freshnessBoost — برای ترتیب نمایش */
  compatibilityScore: number;

  /** metadata برای re-ranking در Feed layer */
  trustScore: number;
  trustMultiplier: number;
  freshnessBoost: number;
}

@Injectable()
export class SuggestionService {
  private readonly logger = new Logger(SuggestionService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly interactionsService: InteractionsService,
    private readonly userEventService: UserEventService,
    private readonly vectorSearch: VectorSearchService,
    private readonly revenueScorer: RevenueScorerService,
    private readonly diversityOptimizer: DiversityOptimizerService,
    private readonly relationStatus: RelationStatusService,
  ) {}

  async getSuggestionsForUser(
    userId: number,
    opts?: { limit?: number; city?: string; targetGender?: string },
  ): Promise<EnrichedSuggestion[]> {
    const startTime = Date.now();
    const limit = opts?.limit ?? 20;

    let resolvedGender: string;
    if (opts?.targetGender) {
      resolvedGender = opts.targetGender;
    } else {
      const currentUser = await this.usersService.findById(userId);
      if (!currentUser) {
        this.logger.error(`User ${userId} not found for gender resolution`);
        return [];
      }
      resolvedGender = getTargetGender(currentUser.gender);
    }

    const candidates = await this.vectorSearch.findCandidates(
      userId,
      200,
      resolvedGender,
    );
    if (candidates.length === 0) return [];

    const scores: ScoreEntry[] = await this.revenueScorer.scoreBatch(
      userId,
      candidates,
    );

    const scoreMap = new Map<number, ScoreEntry>(
      scores.map((s) => [s.candidateId, s]),
    );

    const interactions =
      await this.interactionsService.getUserInteractions(userId);
    const epsilon = this.diversityOptimizer.getAdaptiveEpsilon(
      interactions.length,
    );

    let finalCandidates = scores;
    if (Math.random() < epsilon) {
      finalCandidates = this.diversityOptimizer.exploreExploit(scores);
    }

    const optimized = await this.diversityOptimizer.optimizeWithMMR(
      finalCandidates.map((s) => ({
        id: s.candidateId,
        score: s.expectedRevenue,
        features: {},
      })),
      limit,
    );

    // ترتیب Qdrant → MMR را حفظ می‌کنیم
    const orderedIds = optimized.map((o) => Number(o.id));

    const result = await this.enrichResults(
      userId,
      orderedIds,
      scoreMap,
      resolvedGender,
    );

    this.userEventService
      .log({
        userId,
        type: EventType.AI_SUGGESTION_SHOWN,
        metadata: {
          count: result.length,
          // rawRevenue برای training — نه displayScore
          scores: result.map((r) => r.rawRevenue),
          duration: Date.now() - startTime,
        },
      })
      .catch((err) => this.logger.error('Failed to log suggestion event', err));

    return result;
  }

  private async enrichResults(
    userId: number,
    candidateIds: number[],
    scoreMap: Map<number, ScoreEntry>,
    targetGender: string,
  ): Promise<EnrichedSuggestion[]> {
    if (candidateIds.length === 0) return [];

    const users = await this.usersService.findByIds(candidateIds, {
      relations: ['userImages', 'boost', 'devices'],
      select: [
        'id',
        'nickname',
        'city',
        'gender',
        'birth_year',
        'aboutme',
        'hobbies_self',
        'values_self',
        'isFaceVerified',
        'trustScore',
        'canSendMessage',
        'restrictedUntil',
        'createdAt', // ← برای freshnessBoost
      ],
    });

    // ── Fix بحرانی: ترتیب Qdrant را با Map حفظ کن ──
    // findByIds ترتیب را تضمین نمی‌کند؛ با Map بازسازی می‌کنیم.
    const userMap = new Map(users.map((u) => [u.id, u]));

    const relationsMap = await this.relationStatus.getEffectiveRelationsBatch(
      userId,
      candidateIds,
    );

    const results: EnrichedSuggestion[] = [];

    // پیمایش بر اساس candidateIds (ترتیب Qdrant/MMR)، نه users
    for (const id of candidateIds) {
      const user = userMap.get(id);
      if (!user) continue;

      // ── فیلترها ──
      if (user.gender !== targetGender) continue;

      const rel = relationsMap.get(user.id);
      if (rel?.isBlocked) continue;

      // نقطه مرکزی مودریشن
      if (!canAppearInFeed(user)) {
        this.logger.debug(
          `Suggestion filtered – user ${user.id} failed moderation check`,
        );
        continue;
      }

      // ── امتیازها ──
      const rawRevenue = scoreMap.get(user.id)?.expectedRevenue ?? 0;

      // freshnessBoost: روی display ordering تأثیر دارد، نه ML score
      const freshnessBoost = calculateFreshnessBoost(user.createdAt);

      // trustMultiplier: فقط در Feed layer اعمال می‌شود
      const trustScore = user.trustScore ?? 50;
      const trustMultiplier = calculateTrustMultiplier(trustScore);

      // displayScore = ML × freshness (trust اینجا نیست)
      const displayScore = rawRevenue * freshnessBoost;

      results.push({
        ...SuggestionEntity.fromUser(user, displayScore),

        rawRevenue, // خالص برای training
        compatibilityScore: Math.round(displayScore * 100), // برای نمایش

        trustScore, // metadata
        trustMultiplier, // برای Feed re-ranking
        freshnessBoost, // برای Feed re-ranking

        isOnline: user.devices?.some((d: any) => d.isOnline) ?? false,
        avatar: user.userImages?.find((img: any) => img.isMain)?.url ?? null,
        relation: rel,
      });
    }

    // مرتب‌سازی بر اساس displayScore (freshness لحاظ شده، trust نه)
    return results.sort((a, b) => b.compatibilityScore - a.compatibilityScore);
  }
}
