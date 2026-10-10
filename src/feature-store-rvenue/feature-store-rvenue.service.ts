import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import { Payment } from 'src/payments/entities/payment.entity';
import { User } from 'src/users/entities/user.entity';
import { SEOActivity } from 'src/seo/entities/seo-activity.entity';
import { ExternalSEOToolsService } from 'src/seo/services/external-seo-tools.service';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { EventType } from 'src/user-event/type/event-type.enum';

export interface UserRevenueFeatures {
  userId: number;
  channelType: number;
  keywordDifficulty: number;
  contentLength: number;
  timeToConversion: number;
  cityWeight: number;
  intentScore: number;
  engagementDepth: number;
  retentionImpact: number;
  campaignCost: number;
  competitorPressure: number;
  seasonalityFactor: number;
  segmentSize: number;
  ltv: number;
  cac: number;
  paybackPeriod: number;
}

// کلید اختصاصی برای revenue features — جدا از feature_snapshot
const CACHE_KEY_PREFIX = 'revenue_features';

@Injectable()
export class FeatureStoreRevenueService {
  private readonly logger = new Logger(FeatureStoreRevenueService.name);
  private readonly CACHE_TTL = 3600;

  constructor(
    private readonly redis: RedisService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,
    @InjectRepository(SEOActivity)
    private readonly seoActivityRepo: Repository<SEOActivity>,
    private readonly externalSEOTools: ExternalSEOToolsService,
  ) {}

  private cacheKey(userId: number): string {
    return `${CACHE_KEY_PREFIX}:${userId}`;
  }

  async getUserFeatures(userId: number): Promise<UserRevenueFeatures> {
    const key = this.cacheKey(userId);
    const cached = await this.redis.get(key);

    if (cached) {
      try {
        return JSON.parse(cached) as UserRevenueFeatures;
      } catch {
        this.logger.warn(`Invalid revenue feature cache for user ${userId}`);
        await this.redis.del(key);
      }
    }

    const features = await this.buildFeatures(userId);

    await this.redis.set(key, JSON.stringify(features), this.CACHE_TTL);

    return features;
  }

  private async buildFeatures(userId: number): Promise<UserRevenueFeatures> {
    const [user, payments, events] = await Promise.all([
      this.userRepo.findOne({ where: { id: userId } }),
      this.paymentRepo.find({
        where: { userId, status: 'paid', currency: 'IRT' },
        order: { createdAt: 'ASC' },
      }),
      this.eventRepo.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: 1000,
      }),
    ]);

    if (!user) {
      return {
        userId,
        channelType: 0.5,
        keywordDifficulty: 0.5,
        contentLength: 0.5,
        timeToConversion: 999,
        cityWeight: 0.5,
        intentScore: 0.5,
        engagementDepth: 0,
        retentionImpact: 0.5,
        campaignCost: 0,
        competitorPressure: 0.3,
        seasonalityFactor: 1.0,
        segmentSize: 0.5,
        ltv: 0,
        cac: 0,
        paybackPeriod: 0,
      };
    }

    const firstPayment = payments[0];

    const ltv = payments.reduce((sum, payment) => {
      const amount = Number(payment.amount);
      return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
    }, 0);

    const channelType = this.encodeChannel(
      user?.metadata?.acquisitionSource || 'organic',
    );

    const timeToConversion = firstPayment
      ? Math.ceil(
          (firstPayment.createdAt.getTime() - user.createdAt.getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : 999;

    const [cityWeight, competitorPressure] = await Promise.all([
      this.calculateCityWeight(user?.city),
      this.getCompetitorPressure(user?.city),
    ]);

    const intentScore = this.calculateIntentScore(events);
    const engagementDepth = events.length;
    const seasonalityFactor = this.getSeasonalityFactor();

    return {
      userId,
      channelType,
      keywordDifficulty: 0.5,
      contentLength: 0.5,
      timeToConversion,
      cityWeight,
      intentScore,
      engagementDepth,
      retentionImpact: 0.5,
      campaignCost: 0,
      competitorPressure,
      seasonalityFactor,
      segmentSize: 0.5,
      ltv,
      cac: 0,
      paybackPeriod: 0,
    };
  }

  private encodeChannel(channel: string): number {
    const mapping: Record<string, number> = {
      google: 0.1,
      instagram: 0.2,
      telegram: 0.3,
      linkedin: 0.4,
      medium: 0.5,
      quora: 0.6,
      organic: 0.7,
      direct: 0.8,
      referral: 0.9,
    };
    return mapping[channel] ?? 0.5;
  }

  private async calculateCityWeight(city?: string): Promise<number> {
    if (!city) return 0.5;
    const [userCount, totalUsers] = await Promise.all([
      this.userRepo.count({ where: { city } }),
      this.userRepo.count(),
    ]);
    return Math.min(1, userCount / (totalUsers / 10));
  }

  private calculateIntentScore(events: PartitionedEvent[]): number {
    if (events.length === 0) return 0.5;

    const weights: Partial<Record<EventType, number>> = {
      [EventType.LIKE]: 2,
      [EventType.MESSAGE_SENT]: 3,
      [EventType.SUPERLIKE]: 4,
      [EventType.PAYMENT_INITIATED]: 5,
    };

    let total = 0;
    for (const event of events.slice(0, 50)) {
      total += weights[event.type] ?? 1;
    }
    return Math.min(1, total / 100);
  }

  private async getCompetitorPressure(city?: string): Promise<number> {
    return 0.3;
  }

  private getSeasonalityFactor(): number {
    const month = new Date().getMonth() + 1;
    if ([3, 4, 5, 9, 10].includes(month)) return 1.3;
    if ([6, 7, 8].includes(month)) return 1.5;
    return 0.8;
  }

  async batchGetFeatures(userIds: number[]): Promise<UserRevenueFeatures[]> {
    return Promise.all(userIds.map((id) => this.getUserFeatures(id)));
  }

  async refreshFeatures(userId: number): Promise<void> {
    await this.redis.del(this.cacheKey(userId));
    await this.getUserFeatures(userId);
  }

  async getKeywordDifficulty(keyword: string): Promise<number> {
    const cached = await this.redis.get(`keyword:${keyword}`);
    if (cached) return parseFloat(cached);

    try {
      const difficulty =
        await this.externalSEOTools.getKeywordDifficulty(keyword);
      if (difficulty === null || difficulty === undefined) {
        return 0; // یا مقدار پیش‌فرض
      }

      await this.redis.set(`keyword:${keyword}`, difficulty.toString(), 86400);
      return difficulty;
    } catch {
      return 50;
    }
  }

  async getAllUsers(): Promise<number[]> {
    const users = await this.userRepo.find({ select: ['id'] });
    return users.map((u) => u.id);
  }
}
