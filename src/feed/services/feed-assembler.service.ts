import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  /**
   * خروجی این متد همیشه در بازه 0..1 است.
   *
   * intelligenceScore و decisionScore از مدل:
   *   0..1
   *
   * compatibilityScore قدیمی:
   *   0..100
   */
  private getNormalizedSuggestionScore(suggestion: EnrichedSuggestion): number {
    const enriched = suggestion as EnrichedSuggestion & {
      intelligenceScore?: number;
      decisionScore?: number;
    };

    if (Number.isFinite(enriched.decisionScore)) {
      return this.clamp(enriched.decisionScore!, 0, 1);
    }

    if (Number.isFinite(enriched.intelligenceScore)) {
      return this.clamp(enriched.intelligenceScore!, 0, 1);
    }

    return this.clamp((suggestion.compatibilityScore ?? 0) / 100, 0, 1);
  }

  private scoreSuggestion(
    suggestion: EnrichedSuggestion,
    phase: FeedPhase['phase'],
  ): number {
    const score = this.getNormalizedSuggestionScore(suggestion);

    const enriched = suggestion as EnrichedSuggestion & {
      expectedRevenue?: number;
      intelligenceConfidence?: number;
    };

    return this.scoringService.assignPriority(
      'suggestion',
      {
        intelligenceScore: score,
        expectedRevenue: enriched.expectedRevenue,
        intelligenceConfidence: enriched.intelligenceConfidence,
        trustScore: suggestion.trustScore,
        trustMultiplier: suggestion.trustMultiplier,
        // در SuggestionService تازگی قبلاً لحاظ شده است.
        phase,
        boostActive: false,
      },
      score,
    );
  }

  private async addMonetizedCandidates(
    feed: FeedItem[],
    userIds: number[],
    usedUserIds: Set<number>,
    source: 'boost' | 'vip' | 'credit',
    targetGender: string,
    excludeUserIds: Set<number>,
    phase: FeedPhase['phase'],
  ): Promise<void> {
    const newIds = [
      ...new Set(userIds.filter((id) => Number.isSafeInteger(id) && id > 0)),
    ].filter((id) => !usedUserIds.has(id) && !excludeUserIds.has(id));

    if (newIds.length === 0) return;

    const users = await this.candidateService.getUsersByIds(newIds);

    for (const user of users) {
      if (user.gender !== targetGender) continue;
      if (excludeUserIds.has(user.id) || usedUserIds.has(user.id)) continue;
      if (!canAppearInFeed(user)) continue;

      const freshnessBoost = calculateFreshnessBoost(user.createdAt);
      const trustScore = user.trustScore ?? 50;
      const trustMultiplier = calculateTrustMultiplier(trustScore);

      /*
       * این کاربر به دلیل Boost/VIP/اعتبار وارد candidate pool شده است.
       * این موضوع به‌تنهایی نشان‌دهنده سازگاری رابطه‌ای نیست.
       */
      const priority = this.scoringService.assignPriority(source, {
        trustScore,
        trustMultiplier,
        freshnessBoost,
        phase,
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
    phase: FeedPhase['phase'],
  ): void {
    for (const suggestion of suggestions) {
      if (feed.length >= maximumItems) break;

      const userId = Number(suggestion.id);

      if (!Number.isSafeInteger(userId) || userId <= 0) continue;
      if (usedUserIds.has(userId) || excludeUserIds.has(userId)) continue;
      if (suggestion.gender !== targetGender) continue;
      if (!canAppearInFeed(suggestion)) continue;

      const priority = this.scoreSuggestion(suggestion, phase);

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

    const [user, phaseData] = await Promise.all([
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

    const phaseName: FeedPhase['phase'] = (
      ['cold', 'warm', 'hot'].includes(phaseData.phase)
        ? phaseData.phase
        : 'cold'
    ) as FeedPhase['phase'];

    const enrichedPhase: FeedPhase = {
      phase: phaseName,
      vipActive: isVip,
      boostActive: Boolean(
        user.boost?.activeUntil &&
        new Date(user.boost.activeUntil) > new Date(),
      ),
      everPaid: phaseData.everPaid,
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

    // پیشنهادهای AI در اولویت candidate pool قرار می‌گیرند.
    this.addSuggestionsToFeed(
      feed,
      suggestions as EnrichedSuggestion[],
      usedUserIds,
      excludedIds,
      targetGender,
      limit * 2,
      phaseName,
    );

    await this.addMonetizedCandidates(
      feed,
      boostedIds,
      usedUserIds,
      'boost',
      targetGender,
      excludedIds,
      phaseName,
    );

    await this.addMonetizedCandidates(
      feed,
      vipIds,
      usedUserIds,
      'vip',
      targetGender,
      excludedIds,
      phaseName,
    );

    await this.addMonetizedCandidates(
      feed,
      creditIds,
      usedUserIds,
      'credit',
      targetGender,
      excludedIds,
      phaseName,
    );

    // ابتدا اولویت مشترک را روی تمام منابع اعمال می‌کنیم.
    const sortedFeed = this.scoringService.sortByPriority(feed);

    /*
     * فیلتر بلاک/رابطه را پیش از slice نهایی اجرا می‌کنیم؛
     * در غیر این صورت چند کاربر مسدود می‌توانند ظرفیت صفحه را هدر دهند.
     */
    const allCandidateIds = sortedFeed
      .filter((item) => item.type === 'user')
      .map((item) => (item.data as FeedUser).id);

    const relationsMap = await this.relationService.filterBlockedUsers(
      userId,
      allCandidateIds,
    );

    const relationFilteredFeed = this.relationService.applyRelationFilter(
      sortedFeed,
      relationsMap,
    );

    const limitedFeed = relationFilteredFeed.slice(0, limit);

    const allowedTypes =
      this.promotionService.getAllowedPromotionTypes(enrichedPhase);

    const maxPromotions =
      phaseName === 'cold' ? 1 : phaseName === 'warm' ? 2 : 3;

    const promoPositions = [0, 3, 6, 9]
      .filter((position) => position < limitedFeed.length)
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

    for (let index = 0; index < limitedFeed.length; index++) {
      finalFeed.push(limitedFeed[index]);

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
      `Feed built: user=${userId}, users=${limitedFeed.length}, ` +
        `promotions=${promotionsShown}, duration=${Date.now() - startedAt}ms`,
    );

    return finalFeed.slice(0, limit);
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }
}
