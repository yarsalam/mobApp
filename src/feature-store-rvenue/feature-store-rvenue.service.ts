import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import { Payment } from 'src/payments/entities/payment.entity';
import { User } from 'src/users/entities/user.entity';
import { SEOActivity } from 'src/seo/entities/seo-activity.entity';
import { ExternalSEOToolsService } from 'src/seo/services/external-seo-tools.service';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { EventType } from 'src/user-event/type/event-type.enum';

export interface RevenueFeatureProvenance {
  status: 'observed' | 'derived' | 'missing';
  source: string | null;
  asOf: string | null;
  window: string | null;
  units: string | null;
  transformation: string | null;
  revision: 'revenue-features-v1';
}

export interface UserRevenueFeatures {
  userId: number;
  channelType: number | null;
  keywordDifficulty: number | null;
  contentLength: number | null;
  timeToConversion: number | null;
  cityWeight: number | null;
  intentScore: number | null;
  engagementDepth: number | null;
  retentionImpact: number | null;
  campaignCost: number | null;
  competitorPressure: number | null;
  seasonalityFactor: number | null;
  segmentSize: number | null;
  ltv: number | null;
  cac: number | null;
  paybackPeriod: number | null;
  featureProvenance: Record<string, RevenueFeatureProvenance>;
}

// کلید اختصاصی برای revenue features — جدا از feature_snapshot
const CACHE_KEY_PREFIX = 'revenue_features:v2';

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
      throw new NotFoundException('Revenue feature source user not found');
    }

    const firstPayment = payments[0];
    const acquisitionSource =
      user.acquisitionSource || user.metadata?.acquisitionSource || '';
    const channelType = this.encodeChannel(acquisitionSource);
    const timeToConversion = firstPayment
      ? Math.max(0, Math.ceil(
          (firstPayment.createdAt.getTime() - user.createdAt.getTime()) /
            (1000 * 60 * 60 * 24),
        ))
      : null;
    const cityWeight = await this.calculateCityWeight(user.city);
    const intentScore = this.calculateIntentScore(events);
    const engagementDepth = events.length;
    const asOf = new Date().toISOString();

    const featureProvenance: Record<string, RevenueFeatureProvenance> = {
      channelType: this.provenance(channelType === null ? 'missing' : 'derived',
        channelType === null ? null : 'users.acquisitionSource',
        'signup', 'encoded_category', 'source_category_mapping_v1', asOf),
      keywordDifficulty: this.provenance('missing', null, null, null, null, null),
      contentLength: this.provenance('missing', null, null, null, null, null),
      timeToConversion: this.provenance(timeToConversion === null ? 'missing' : 'derived',
        timeToConversion === null ? null : 'users.createdAt+payments.createdAt',
        'signup_to_first_paid_payment', 'days', 'first_paid_payment_delta_days_v1', asOf),
      cityWeight: this.provenance(cityWeight === null ? 'missing' : 'derived',
        cityWeight === null ? null : 'users.city_aggregate',
        'current_user_population', 'ratio', 'city_population_share_v1', asOf),
      intentScore: this.provenance(intentScore === null ? 'missing' : 'derived',
        intentScore === null ? null : 'PartitionedEvent.type',
        'latest_1000_events', 'normalized_score', 'event_type_weight_sum_v1', asOf),
      engagementDepth: this.provenance('observed', 'PartitionedEvent',
        'latest_1000_events', 'event_count', 'count_events_v1', asOf),
      retentionImpact: this.provenance('missing', null, null, null, null, null),
      campaignCost: this.provenance('missing', null, null, null, null, null),
      competitorPressure: this.provenance('missing', null, null, null, null, null),
      seasonalityFactor: this.provenance('missing', null, null, null, null, null),
      segmentSize: this.provenance('missing', null, null, null, null, null),
    };

    return {
      userId,
      channelType,
      keywordDifficulty: null,
      contentLength: null,
      timeToConversion,
      cityWeight,
      intentScore,
      engagementDepth,
      retentionImpact: null,
      campaignCost: null,
      competitorPressure: null,
      seasonalityFactor: null,
      segmentSize: null,
      // The legacy paid-IRT sum excludes refund/chargeback semantics; do not
      // expose it as realized LTV until that contract is implemented.
      ltv: null,
      cac: null,
      paybackPeriod: null,
      featureProvenance,
    };
  }

  private encodeChannel(channel: string): number | null {
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
    return mapping[channel] ?? null;
  }

  private async calculateCityWeight(city?: string): Promise<number | null> {
    if (!city) return null;
    const [userCount, totalUsers] = await Promise.all([
      this.userRepo.count({ where: { city } }),
      this.userRepo.count(),
    ]);
    if (totalUsers <= 0) return null;
    return Math.min(1, userCount / (totalUsers / 10));
  }

  private calculateIntentScore(events: PartitionedEvent[]): number | null {
    if (events.length === 0) return null;

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

  private provenance(
    status: RevenueFeatureProvenance['status'],
    source: string | null,
    window: string | null,
    units: string | null,
    transformation: string | null,
    asOf: string | null,
  ): RevenueFeatureProvenance {
    return {
      status,
      source,
      asOf,
      window,
      units,
      transformation,
      revision: 'revenue-features-v1',
    };
  }

  async batchGetFeatures(userIds: number[]): Promise<UserRevenueFeatures[]> {
    return Promise.all(userIds.map((id) => this.getUserFeatures(id)));
  }

  async refreshFeatures(userId: number): Promise<void> {
    await this.redis.del(this.cacheKey(userId));
    await this.getUserFeatures(userId);
  }

  async getKeywordDifficulty(_keyword: string): Promise<number | null> {
    return null;
  }

  async getAllUsers(): Promise<number[]> {
    const users = await this.userRepo.find({ select: ['id'] });
    return users.map((u) => u.id);
  }
}
