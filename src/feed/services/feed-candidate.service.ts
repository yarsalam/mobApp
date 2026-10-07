import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
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

  private randomSample<T>(arr: T[], count: number): T[] {
    if (arr.length <= count) return arr;
    return [...arr].sort(() => 0.5 - Math.random()).slice(0, count);
  }

  /**
   * فیلتر جنسیت + مودریشن از نقطه مرکزی.
   * اگر multi-level moderation اضافه شد، فقط canAppearInFeed تغییر می‌کند.
   */
  private async filterIdsByGender(
    ids: number[],
    targetGender: string,
  ): Promise<number[]> {
    if (ids.length === 0) return [];

    const users = await this.userRepo.find({
      where: { id: In(ids), gender: targetGender, status: 'active' },
      select: ['id', 'canSendMessage', 'restrictedUntil'],
    });

    return users.filter((u) => canAppearInFeed(u)).map((u) => u.id);
  }

  async getBoostedCandidates(
    targetGender: string,
    limit: number,
  ): Promise<number[]> {
    const boosted = await this.boostQueueService.getBoostedUsers(10);
    const filtered = await this.filterIdsByGender(boosted, targetGender);
    return this.randomSample(filtered, limit);
  }

  async getVipCandidates(
    targetGender: string,
    limit: number,
  ): Promise<number[]> {
    const vip = await this.boostQueueService.getActiveVipUsers(8);
    const filtered = await this.filterIdsByGender(vip, targetGender);
    return this.randomSample(filtered, limit);
  }

  async getHighCreditCandidates(
    targetGender: string,
    limit: number,
  ): Promise<number[]> {
    const credit = await this.boostQueueService.getHighCreditUsers(8);
    const filtered = await this.filterIdsByGender(credit, targetGender);
    return this.randomSample(filtered, limit);
  }

  async getSuggestionCandidates(
    userId: number,
    targetGender: string,
    limit: number,
  ) {
    // SuggestionService خودش مودریشن، trust، freshness را اعمال می‌کند
    return this.suggestionService.getSuggestionsForUser(userId, {
      limit: limit * 2,
      targetGender,
    });
  }

  async getUsersByIds(ids: number[]): Promise<User[]> {
    if (ids.length === 0) return [];
    return this.userRepo.find({
      where: { id: In(ids), status: 'active' },
      relations: ['userImages', 'boost'],
      // بدون select → همه فیلدها برمی‌گردند (createdAt, trustScore, ...)
    });
  }
}
