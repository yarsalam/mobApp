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

  /**
   * امتیاز compatibility واقعی.
   *
   * دیگر Revenue score نیست.
   */
  compatibilityScore: number;

  /**
   * امتیاز خام Intelligence قبل از freshness.
   */
  intelligenceScore: number;

  /**
   * Business / monetization signal.
   */
  expectedRevenue: number;

  /**
   * confidence مدل.
   */
  intelligenceConfidence: number;

  /**
   * metadata برای Feed و training.
   */
  trustScore: number;
  trustMultiplier: number;
  freshnessBoost: number;

  /**
   * اجزای مدل برای analytics.
   */
  scoreComponents: RevenueScore['components'];
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
    opts?: {
      limit?: number;
      city?: string;
      targetGender?: string;
    },
  ): Promise<EnrichedSuggestion[]> {
    const startTime = Date.now();

    const limit = Math.max(1, Math.min(opts?.limit ?? 20, 100));

    // ─────────────────────────────────────────────────────────────
    // Target gender
    // ─────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────
    // 1. Retrieval
    // ─────────────────────────────────────────────────────────────

    const candidates = await this.vectorSearch.findCandidates(
      userId,
      200,
      resolvedGender,
    );

    if (candidates.length === 0) {
      return [];
    }

    // ─────────────────────────────────────────────────────────────
    // 2. Intelligence scoring
    // ─────────────────────────────────────────────────────────────

    const scores = await this.revenueScorer.scoreBatch(userId, candidates);

    if (scores.length === 0) {
      return [];
    }

    const scoreMap = new Map<number, RevenueScore>(
      scores.map((score) => [score.candidateId, score]),
    );

    // ─────────────────────────────────────────────────────────────
    // 3. Exploration / exploitation
    // ─────────────────────────────────────────────────────────────

    const interactions =
      await this.interactionsService.getUserInteractions(userId);

    const epsilon = this.diversityOptimizer.getAdaptiveEpsilon(
      interactions.length,
    );

    let rankedCandidates = [...scores];

    if (Math.random() < epsilon) {
      rankedCandidates = this.diversityOptimizer
        .exploreExploit(
          rankedCandidates.map((candidate) => ({
            ...candidate,
            score: candidate.decisionScore,
          })),
        )
        .map(({ score: _score, ...candidate }) => candidate);
    }

    // ─────────────────────────────────────────────────────────────
    // 4. MMR
    // ─────────────────────────────────────────────────────────────
    //
    // MMR relevance = decisionScore
    //
    // Diversity در DiversityOptimizer
    // با FeatureStore محاسبه می‌شود.
    // ─────────────────────────────────────────────────────────────

    const optimized = await this.diversityOptimizer.optimizeWithMMR(
      rankedCandidates.map((score) => ({
        id: score.candidateId,
        score: score.decisionScore,
      })),
      limit,
    );

    const orderedIds = optimized.map((item) => Number(item.id));

    // ─────────────────────────────────────────────────────────────
    // 5. Enrichment + hard filters
    // ─────────────────────────────────────────────────────────────

    const result = await this.enrichResults(
      userId,
      orderedIds,
      scoreMap,
      resolvedGender,
    );

    // ─────────────────────────────────────────────────────────────
    // 6. Analytics event
    // ─────────────────────────────────────────────────────────────

    this.userEventService
      .log({
        userId,
        type: EventType.AI_SUGGESTION_SHOWN,
        metadata: {
          count: result.length,

          intelligenceScores: result.map((item) => item.intelligenceScore),

          expectedRevenue: result.map((item) => item.expectedRevenue),

          confidence: result.map((item) => item.intelligenceConfidence),

          duration: Date.now() - startTime,

          epsilon,
        },
      })
      .catch((err) => this.logger.error('Failed to log suggestion event', err));

    return result;
  }

  private async enrichResults(
    userId: number,
    candidateIds: number[],
    scoreMap: Map<number, RevenueScore>,
    targetGender: string,
  ): Promise<EnrichedSuggestion[]> {
    if (candidateIds.length === 0) {
      return [];
    }

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

    // ترتیب MMR حفظ می‌شود.
    for (const id of candidateIds) {
      const user = userMap.get(id);

      if (!user) {
        continue;
      }

      // ─────────────────────────────────────────
      // Hard filters
      // ─────────────────────────────────────────

      if (user.gender !== targetGender) {
        continue;
      }

      const relation = relationsMap.get(user.id);

      if (relation?.isBlocked) {
        continue;
      }

      if (!canAppearInFeed(user)) {
        this.logger.debug(
          `Suggestion filtered – user ${user.id} failed moderation check`,
        );

        continue;
      }

      // ─────────────────────────────────────────
      // Intelligence score
      // ─────────────────────────────────────────

      const score = scoreMap.get(user.id);

      if (!score) {
        continue;
      }

      const intelligenceScore = score.decisionScore;

      // ─────────────────────────────────────────
      // Freshness
      // ─────────────────────────────────────────

      const freshnessBoost = calculateFreshnessBoost(user.createdAt);

      /**
       * Freshness فقط display/feed signal است.
       *
       * مدل ML را تغییر نمی‌دهیم.
       */
      const displayScore = intelligenceScore * freshnessBoost;

      // ─────────────────────────────────────────
      // Trust
      // ─────────────────────────────────────────

      const trustScore = user.trustScore ?? 50;

      const trustMultiplier = calculateTrustMultiplier(trustScore);

      const compatibilityScore = Math.round(displayScore * 100);

      results.push({
        ...SuggestionEntity.fromUser(user, displayScore),

        compatibilityScore,

        intelligenceScore,

        expectedRevenue: score.expectedRevenue,

        intelligenceConfidence: score.confidence,

        trustScore,

        trustMultiplier,

        freshnessBoost,

        scoreComponents: score.components,

        isOnline: user.devices?.some((device: any) => device.isOnline) ?? false,

        avatar:
          user.userImages?.find((image: any) => image.isMain)?.url ?? null,

        relation,
      });
    }

    // ترتیب نهایی display.
    return results.sort((a, b) => b.compatibilityScore - a.compatibilityScore);
  }
}
