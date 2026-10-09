import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { InteractionsService } from 'src/interaction/interaction.service';
import { UserEventService } from 'src/user-event/user-event.service';
import { VectorSearchService } from './retrieval/vector-search.service';
import {
  RevenueScorerService,
  RevenueScore,
} from './scoring/revenue-scorer.service';
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

export interface EnrichedSuggestion extends SuggestionEntity {
  /** امتیاز درآمدی؛ برای تحلیل و یادگیری، نه رتبه‌بندی اصلی */
  rawRevenue: number;

  /** امتیاز سازگاری رابطه‌ای با freshness در بازه تقریبی 0..100 */
  compatibilityScore: number;

  /** امتیاز خالص سازگاری، پیش از freshness */
  intelligenceScore: number;

  /** confidence مدل در بازه 0..1 */
  intelligenceConfidence: number;

  trustScore: number;
  trustMultiplier: number;
  freshnessBoost: number;
  scoreComponents: RevenueScore['components'];
  isOnline?: boolean;
  relation?: unknown;
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
    const limit = Math.max(1, Math.min(Math.floor(opts?.limit ?? 20), 100));

    let targetGender = opts?.targetGender;

    if (!targetGender) {
      const currentUser = await this.usersService.findById(userId);
      if (!currentUser) {
        this.logger.warn(`Suggestion request: user ${userId} not found`);
        return [];
      }
      targetGender = getTargetGender(currentUser.gender);
    }

    const candidates = await this.vectorSearch.findCandidates(
      userId,
      Math.max(200, limit * 5),
      targetGender,
    );

    if (!candidates.length) return [];

    const scores = await this.revenueScorer.scoreBatch(userId, candidates);
    if (!scores.length) return [];

    const scoreMap = new Map<number, RevenueScore>(
      scores.map((score) => [score.candidateId, score]),
    );

    const interactions =
      await this.interactionsService.getUserInteractions(userId);

    const epsilon = this.diversityOptimizer.getAdaptiveEpsilon(
      interactions.length,
    );

    /*
     * Exploration must not replace scoring with a random shuffle.
     * It only changes candidate ordering before MMR; the score remains
     * attached to each candidate and is still used by the optimizer.
     */
    const explorationPool =
      Math.random() < epsilon
        ? this.diversityOptimizer.exploreExploit(scores)
        : scores;

    const optimized = await this.diversityOptimizer.optimizeWithMMR(
      explorationPool.map((score) => ({
        id: score.candidateId,
        score: score.decisionScore,
      })),
      limit,
    );

    const orderedIds = [
      ...new Set(
        optimized
          .map((item) => Number(item.id))
          .filter((id) => Number.isSafeInteger(id) && id > 0 && id !== userId),
      ),
    ];

    const result = await this.enrichResults(
      userId,
      orderedIds,
      scoreMap,
      targetGender,
      opts?.city,
    );

    this.userEventService
      .log({
        userId,
        type: EventType.AI_SUGGESTION_SHOWN,
        metadata: {
          count: result.length,
          scores: result.map((item) => ({
            candidateId: item.id,
            compatibility: item.intelligenceScore,
            decision: scoreMap.get(item.id)?.decisionScore ?? 0,
            confidence: item.intelligenceConfidence,
          })),
          duration: Date.now() - startTime,
        },
      })
      .catch((error) => {
        this.logger.warn(
          `Failed to log suggestion event: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });

    return result;
  }

  private async enrichResults(
    userId: number,
    candidateIds: number[],
    scoreMap: Map<number, RevenueScore>,
    targetGender: string,
    city?: string,
  ): Promise<EnrichedSuggestion[]> {
    if (!candidateIds.length) return [];

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
        'createdAt',
      ],
    });

    const userMap = new Map(users.map((user) => [user.id, user]));

    const relationsMap = await this.relationStatus.getEffectiveRelationsBatch(
      userId,
      candidateIds,
    );

    const results: EnrichedSuggestion[] = [];

    // Iterate candidateIds to preserve the scorer/MMR order.
    for (const candidateId of candidateIds) {
      const user = userMap.get(candidateId);
      const score = scoreMap.get(candidateId);

      if (!user || !score) continue;
      if (user.id === userId || user.gender !== targetGender) continue;

      if (city && user.city !== city) continue;

      const relation = relationsMap.get(user.id);
      if (relation?.isBlocked) continue;
      if (!canAppearInFeed(user)) continue;

      const freshnessBoost = calculateFreshnessBoost(user.createdAt);
      const trustScore = user.trustScore ?? 50;
      const trustMultiplier = calculateTrustMultiplier(trustScore);

      // Freshness affects display ordering, not the underlying model score.
      const displayScore = Math.max(
        0,
        Math.min(100, score.compatibilityScore * freshnessBoost * 100),
      );

      const base = SuggestionEntity.fromUser(user, displayScore);

      results.push({
        ...base,
        rawRevenue: score.expectedRevenue,
        compatibilityScore: displayScore,
        intelligenceScore: score.compatibilityScore,
        intelligenceConfidence: score.confidence,
        trustScore,
        trustMultiplier,
        freshnessBoost,
        scoreComponents: score.components,
        isOnline:
          user.devices?.some((device: { isOnline?: boolean }) =>
            Boolean(device.isOnline),
          ) ?? false,
        avatar:
          user.userImages?.find((image: { isMain?: boolean }) => image.isMain)
            ?.url ?? null,
        relation,
      });
    }

    return results.sort((a, b) => b.compatibilityScore - a.compatibilityScore);
  }
}
