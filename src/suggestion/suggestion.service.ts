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

  /** امتیاز سازگاری نمایشی با freshness، در بازه 0..100 */
  compatibilityScore: number;

  /** امتیاز خالص سازگاری مدل، در بازه 0..1 */
  intelligenceScore: number;

  /** اطمینان مدل، در بازه 0..1 */
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

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return [];
    }

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

    if (candidates.length === 0) {
      return [];
    }

    const scores = await this.revenueScorer.scoreBatch(userId, candidates);

    if (scores.length === 0) {
      return [];
    }

    const scoreMap = new Map<number, RevenueScore>(
      scores.map((score) => [score.candidateId, score]),
    );

    const interactions =
      await this.interactionsService.getUserInteractions(userId);

    const epsilon = this.diversityOptimizer.getAdaptiveEpsilon(
      interactions.length,
    );

    /*
     * Exploration به‌جای به‌هم‌ریختن تصادفی ترتیب:
     * وزن diversity را در MMR بیشتر می‌کند.
     *
     * exploitation: تاکید بیشتر بر relevance
     * exploration: تاکید بیشتر بر تنوع
     */
    const explore = Math.random() < epsilon;
    const mmrLambda = explore ? 0.58 : 0.72;

    /*
     * کمی بیشتر از تعداد نهایی انتخاب می‌کنیم تا اگر بعضی کاربران
     * به‌دلیل شهر، بلاک یا moderation حذف شدند، فید خالی نماند.
     */
    const optimizationLimit = Math.min(
      scores.length,
      Math.max(limit * 3, limit),
    );

    const optimized = await this.diversityOptimizer.optimizeWithMMR(
      scores.map((score) => ({
        id: score.candidateId,
        score: score.decisionScore,
      })),
      optimizationLimit,
      mmrLambda,
    );

    const orderedIds = [
      ...new Set(
        optimized
          .map((item) => Number(item.id))
          .filter((id) => Number.isSafeInteger(id) && id > 0 && id !== userId),
      ),
    ];

    const enriched = await this.enrichResults(
      userId,
      orderedIds,
      scoreMap,
      targetGender,
      opts?.city,
    );

    // ترتیب MMR حفظ می‌شود؛ مرتب‌سازی دوباره بر اساس compatibility ممنوع است.
    const result = enriched.slice(0, limit);

    this.userEventService
      .log({
        userId,
        type: EventType.AI_SUGGESTION_SHOWN,
        metadata: {
          count: result.length,
          exploration: explore,
          mmrLambda,
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

    /*
     * مهم:
     * پیمایش دقیقاً بر اساس candidateIds انجام می‌شود.
     * این ترتیب از خروجی MMR آمده و باید حفظ شود.
     */
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

      /*
       * compatibilityScore برای سازگاری با مصرف‌کنندگان قدیمی API
       * همچنان در بازه 0..100 باقی می‌ماند.
       *
       * intelligenceScore امتیاز خام مدل و در بازه 0..1 است.
       */
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

    // مرتب‌سازی مجدد در اینجا عمداً انجام نمی‌شود.
    return results;
  }
}
