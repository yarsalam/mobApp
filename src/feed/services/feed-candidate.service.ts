import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { BoostQueueService } from '../../redis/boost-queue.service';
import { SuggestionService } from '../../suggestion/suggestion.service';
import { canAppearInFeed } from '../../moderation/moderation.utils';

@Injectable()
export class FeedCandidateService {
  private readonly logger = new Logger(FeedCandidateService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly boostQueueService: BoostQueueService,
    private readonly suggestionService: SuggestionService,
  ) {}

  private shuffle<T>(items: T[]): T[] {
    const result = [...items];

    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
  }

  private randomSample<T>(items: T[], count: number): T[] {
    const safeCount = Math.max(
      0,
      Number.isFinite(count) ? Math.floor(count) : 0,
    );

    if (safeCount === 0 || items.length === 0) {
      return [];
    }

    if (items.length <= safeCount) {
      return [...items];
    }

    return this.shuffle(items).slice(0, safeCount);
  }

  private normalizeIds(ids: number[]): number[] {
    return [
      ...new Set(
        (ids ?? [])
          .map(Number)
          .filter((id) => Number.isSafeInteger(id) && id > 0),
      ),
    ];
  }

  private async filterIdsByGender(
    ids: number[],
    targetGender: string,
  ): Promise<number[]> {
    const uniqueIds = this.normalizeIds(ids);

    if (uniqueIds.length === 0) {
      return [];
    }

    const users = await this.userRepo.find({
      where: {
        id: In(uniqueIds),
        gender: targetGender,
        status: 'active',
      },
      select: ['id', 'canSendMessage', 'restrictedUntil'],
    });

    const eligibleIds = new Set(
      users.filter((user) => canAppearInFeed(user)).map((user) => user.id),
    );

    return uniqueIds.filter((id) => eligibleIds.has(id));
  }

  async getBoostedCandidates(
    targetGender: string,
    limit: number,
  ): Promise<number[]> {
    if (!Number.isFinite(limit) || limit <= 0) {
      return [];
    }

    try {
      const boostedIds = await this.boostQueueService.getBoostedUsers(
        Math.min(Math.max(Math.floor(limit) * 4, 10), 100),
      );

      const eligibleIds = await this.filterIdsByGender(
        boostedIds,
        targetGender,
      );

      return this.randomSample(eligibleIds, limit);
    } catch (error) {
      this.logger.warn(
        `Could not retrieve boosted candidates: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return [];
    }
  }

  async getVipCandidates(
    targetGender: string,
    limit: number,
  ): Promise<number[]> {
    if (!Number.isFinite(limit) || limit <= 0) {
      return [];
    }

    try {
      const vipIds = await this.boostQueueService.getActiveVipUsers(
        Math.min(Math.max(Math.floor(limit) * 4, 8), 100),
      );

      const eligibleIds = await this.filterIdsByGender(vipIds, targetGender);

      return this.randomSample(eligibleIds, limit);
    } catch (error) {
      this.logger.warn(
        `Could not retrieve VIP candidates: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return [];
    }
  }

  async getHighCreditCandidates(
    targetGender: string,
    limit: number,
  ): Promise<number[]> {
    if (!Number.isFinite(limit) || limit <= 0) {
      return [];
    }

    try {
      const creditIds = await this.boostQueueService.getHighCreditUsers(
        Math.min(Math.max(Math.floor(limit) * 4, 8), 100),
      );

      const eligibleIds = await this.filterIdsByGender(creditIds, targetGender);

      return this.randomSample(eligibleIds, limit);
    } catch (error) {
      this.logger.warn(
        `Could not retrieve high-credit candidates: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return [];
    }
  }

  /**
   * مسیر اصلی پیشنهادها باید از AI scorer و MMR عبور کند.
   * عضویت در Boost/VIP/اعتبار جایگزین این مسیر نیست.
   */
  async getSuggestionCandidates(
    userId: number,
    targetGender: string,
    limit: number,
  ) {
    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      !Number.isFinite(limit) ||
      limit <= 0
    ) {
      return [];
    }

    return this.suggestionService.getSuggestionsForUser(userId, {
      limit: Math.min(Math.floor(limit) * 2, 200),
      targetGender,
    });
  }

  /**
   * اطلاعات کاربران فعال را بارگذاری می‌کند و ترتیب شناسه‌های
   * ورودی را حفظ می‌کند؛ ترتیب TypeORM تضمین‌شده نیست.
   */
  async getUsersByIds(ids: number[]): Promise<User[]> {
    const uniqueIds = this.normalizeIds(ids);

    if (uniqueIds.length === 0) {
      return [];
    }

    const users = await this.userRepo.find({
      where: {
        id: In(uniqueIds),
        status: 'active',
      },
      relations: ['userImages', 'boost'],
    });

    const userMap = new Map(users.map((user) => [user.id, user]));

    return uniqueIds
      .map((id) => userMap.get(id))
      .filter((user): user is User => Boolean(user));
  }
}
