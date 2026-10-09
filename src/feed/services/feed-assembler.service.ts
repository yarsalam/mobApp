import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { randomUUID } from 'crypto';

import { User } from '../../users/entities/user.entity';
import { PhaseService } from '../../phase/phase.service';
import { VipService } from '../../payments/vip/vip.service';
import { CreditsService } from '../../payments/credits/credits.service';
import { SEOCollectorService } from '../../seo/services/seo-collector.service';

import { FeedCandidateService } from './feed-candidate.service';
import { FeedScoringService } from './feed-scoring.service';
import { FeedRelationService } from './feed-relation.service';
import { FeedPromotionService } from './feed-promotion.service';

import { BuildFeedOptions, FeedItem, FeedUser } from '../types/feed.types';
import { FeedPhase } from '../types/feed-phase.interface';
import { UserImage } from '../../user_images/entities/user_image.entity';
import { getTargetGender } from '../../common/utils/gender.util';

import {
  canAppearInFeed,
  calculateFreshnessBoost,
  calculateTrustMultiplier,
} from '../../moderation/moderation.utils';

import { EnrichedSuggestion } from '../../suggestion/suggestion.service';

@Injectable()
export class FeedAssemblerService {
  private readonly logger = new Logger(FeedAssemblerService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly vipService: VipService,
    private readonly creditsService: CreditsService,
    private readonly seoCollector: SEOCollectorService,
    private readonly candidateService: FeedCandidateService,
    private readonly scoringService: FeedScoringService,
    private readonly relationService: FeedRelationService,
    private readonly promotionService: FeedPromotionService,
    private readonly phaseService: PhaseService,
  ) {}

  private mapUserToFeed(user: any): FeedUser {
    const images: UserImage[] = user.userImages ?? [];

    const mainImage = images.find((image) => image.isMain) ?? images[0];

    return {
      id: user.id,
      nickname: user.nickname,
      city: user.city,
      gender: user.gender,
      age: user.age ?? this.calculateAge(user.birth_year ?? ''),
      hobbies_self: (user.hobbies_self ?? user.hobbies ?? []).slice(0, 3),
      values_self: (user.values_self ?? user.values ?? []).slice(0, 3),
      userImages: mainImage ? [{ url: mainImage.url, isMain: true }] : [],
    };
  }

  private calculateAge(birthYear: string): number {
    if (!birthYear) return 0;

    const year = Number.parseInt(birthYear, 10);
    if (!Number.isFinite(year)) return 0;

    const currentYear = new Date().getFullYear();

    const age =
      year > 1300 && year < 1420
        ? currentYear - (year + 621)
        : currentYear - year;

    return Math.max(0, Math.min(100, age));
  }

  private getSuggestionScore(suggestion: EnrichedSuggestion): number {
    const enriched = suggestion as EnrichedSuggestion & {
      intelligenceScore?: number;
      decisionScore?: number;
    };

    // Prefer the new AI decision score, then intelligence,
    // then the compatibility score retained for older callers.
    const score =
      enriched.decisionScore ??
      enriched.intelligenceScore ??
      suggestion.compatibilityScore ??
      0;

    return Number.isFinite(score) ? score : 0;
  }

  private scoreSuggestion(suggestion: EnrichedSuggestion): number {
    const score = this.getSuggestionScore(suggestion);

    const enriched = suggestion as EnrichedSuggestion & {
      intelligenceScore?: number;
      expectedRevenue?: number;
      intelligenceConfidence?: number;
    };

    return this.scoringService.assignPriority(
      'suggestion',
      {
        intelligenceScore: enriched.intelligenceScore ?? score,
        expectedRevenue: enriched.expectedRevenue,
        intelligenceConfidence: enriched.intelligenceConfidence,
        trustScore: suggestion.trustScore,
        trustMultiplier: suggestion.trustMultiplier,
        freshnessBoost: suggestion.freshnessBoost,
        phase: 'warm',
        boostActive: false,
      },
      score / 100,
    );
  }

  private async addMonetizedCandidates(
    feed: FeedItem[],
    userIds: number[],
    usedUserIds: Set<number>,
    source: 'boost' | 'vip' | 'credit',
    targetGender: string,
    excludeUserIds: Set<number>,
  ): Promise<void> {
    const newIds = [...new Set(userIds)].filter(
      (id) => !usedUserIds.has(id) && !excludeUserIds.has(id),
    );

    if (newIds.length === 0) return;

    const users = await this.candidateService.getUsersByIds(newIds);

    for (const user of users) {
      if (user.gender !== targetGender) continue;
      if (excludeUserIds.has(user.id)) continue;
      if (!canAppearInFeed(user)) continue;

      const freshnessBoost = calculateFreshnessBoost(user.createdAt);

      const trustScore = user.trustScore ?? 50;
      const trustMultiplier = calculateTrustMultiplier(trustScore);

      /*
       * These candidates may enter the feed because of a
       * monetization feature, but that feature must not be
       * treated as proof of relationship compatibility.
       *
       * FeedScoringService applies the source's limited
       * fallback score and quality multipliers.
       */
      const priority = this.scoringService.assignPriority(source, {
        trustScore,
        trustMultiplier,
        freshnessBoost,
        phase: 'warm',
        boostActive: source === 'boost',
      });

      feed.push({
        id: randomUUID(),
        type: 'user',
        data: this.mapUserToFeed(user),
        priority,
      });

      usedUserIds.add(user.id);
    }
  }

  private addSuggestionsToFeed(
    feed: FeedItem[],
    suggestions: EnrichedSuggestion[],
    usedUserIds: Set<number>,
    excludeUserIds: Set<number>,
    targetGender: string,
    maximumItems: number,
  ): void {
    for (const suggestion of suggestions) {
      if (feed.length >= maximumItems) break;

      const userId = suggestion.id;

      if (!userId || usedUserIds.has(userId)) continue;
      if (excludeUserIds.has(userId)) continue;
      if (suggestion.gender !== targetGender) continue;
      if (!canAppearInFeed(suggestion)) continue;

      const priority = this.scoreSuggestion(suggestion);

      feed.push({
        id: randomUUID(),
        type: 'user',
        data: this.mapUserToFeed(suggestion),
        priority,
      });

      usedUserIds.add(userId);
    }
  }

  async buildFeed(
    userId: number,
    options: BuildFeedOptions = {},
  ): Promise<FeedItem[]> {
    const startedAt = Date.now();
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

    const excludedIds = new Set<number>([
      userId,
      ...(options.excludeUserIds ?? []),
    ]);

    const [user, phase] = await Promise.all([
      this.userRepo.findOne({
        where: { id: userId, status: 'active' },
        relations: ['userImages', 'boost'],
      }),
      this.phaseService.get(userId),
    ]);

    if (!user) return [];

    const targetGender = getTargetGender(user.gender);

    const [isVip, _credit] = await Promise.all([
      this.vipService.hasVip(userId),
      this.creditsService.get(userId),
    ]);

    const enrichedPhase: FeedPhase = {
      phase: (['cold', 'warm', 'hot'].includes(phase.phase)
        ? phase.phase
        : 'cold') as FeedPhase['phase'],
      vipActive: isVip,
      boostActive: Boolean(
        user.boost?.activeUntil &&
        new Date(user.boost.activeUntil) > new Date(),
      ),
      everPaid: phase.everPaid,
      isCompleted: user.isCompleted,
    };

    const [boostedIds, vipIds, creditIds, suggestions] = await Promise.all([
      this.candidateService.getBoostedCandidates(targetGender, 3),
      this.candidateService.getVipCandidates(targetGender, 2),
      this.candidateService.getHighCreditCandidates(targetGender, 2),
      this.candidateService.getSuggestionCandidates(
        userId,
        targetGender,
        limit,
      ),
    ]);

    const feed: FeedItem[] = [];
    const usedUserIds = new Set<number>(excludedIds);

    /*
     * Add the AI-ranked suggestions first. This makes the
     * relationship-intelligence score the main ranking signal.
     */
    this.addSuggestionsToFeed(
      feed,
      suggestions as EnrichedSuggestion[],
      usedUserIds,
      excludedIds,
      targetGender,
      limit * 2,
    );

    /*
     * Add eligible monetized candidates only when they have
     * not already appeared in the AI suggestion list.
     * The scoring service controls their limited fallback score.
     */
    await this.addMonetizedCandidates(
      feed,
      boostedIds,
      usedUserIds,
      'boost',
      targetGender,
      excludedIds,
    );

    await this.addMonetizedCandidates(
      feed,
      vipIds,
      usedUserIds,
      'vip',
      targetGender,
      excludedIds,
    );

    await this.addMonetizedCandidates(
      feed,
      creditIds,
      usedUserIds,
      'credit',
      targetGender,
      excludedIds,
    );

    // Apply the same final ordering to every candidate source.
    const sortedFeed = this.scoringService.sortByPriority(feed);

    const limitedFeed = sortedFeed.slice(0, limit);

    const targetIds = limitedFeed
      .filter((item) => item.type === 'user')
      .map((item) => (item.data as FeedUser).id);

    const relationsMap = await this.relationService.filterBlockedUsers(
      userId,
      targetIds,
    );

    const filteredFeed = this.relationService.applyRelationFilter(
      limitedFeed,
      relationsMap,
    );

    const allowedTypes =
      this.promotionService.getAllowedPromotionTypes(enrichedPhase);

    const maxPromotions =
      enrichedPhase.phase === 'cold'
        ? 1
        : enrichedPhase.phase === 'warm'
          ? 2
          : 3;

    const promoPositions = [0, 3, 6, 9]
      .filter((position) => position < filteredFeed.length)
      .slice(0, maxPromotions);

    const promotions = await this.promotionService.decideBatch(
      userId,
      allowedTypes,
      enrichedPhase,
      promoPositions,
    );

    const finalFeed: FeedItem[] = [];
    let promotionIndex = 0;
    let promotionsShown = 0;

    for (let index = 0; index < filteredFeed.length; index++) {
      finalFeed.push(filteredFeed[index]);

      if (
        promotionIndex < promoPositions.length &&
        index === promoPositions[promotionIndex]
      ) {
        const promotion = promotions[promotionIndex];

        if (promotion) {
          finalFeed.push(promotion);
          promotionsShown++;
        }

        promotionIndex++;
      }
    }

    this.seoCollector
      .collectFeedMetrics(userId, finalFeed.length)
      .catch((error) => {
        this.logger.error(
          'SEO collection failed',
          error instanceof Error ? error.stack : String(error),
        );
      });

    this.logger.log(
      `Feed built: user=${userId}, users=${filteredFeed.length}, ` +
        `promotions=${promotionsShown}, duration=${Date.now() - startedAt}ms`,
    );

    return finalFeed.slice(0, limit);
  }
}
