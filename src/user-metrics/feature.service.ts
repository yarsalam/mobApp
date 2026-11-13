import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class FeatureService {
  private readonly logger = new Logger(FeatureService.name);

  constructor(
    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getUserFeatures(userId: number): Promise<Record<string, number>> {
    const [user, events] = await Promise.all([
      this.userRepo.findOne({ where: { id: userId } }),
      this.getUserEvents(userId),
    ]);

    if (!user) throw new NotFoundException('User feature profile not found');

    const daysSinceSignup = Math.max(
      1,
      Math.floor(
        (Date.now() - new Date(user.createdAt).getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    );

    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);

    const features = {
      engagement_score: await this.calculateEngagementScore(userId, events),
      days_since_signup: daysSinceSignup,
      swipe_velocity: await this.calculateSwipeVelocity(userId, last7Days),
      recent_event_count: events.filter(
        (event) => new Date(event.createdAt).getTime() >= last7Days.getTime(),
      ).length,
      dismiss_rate: await this.calculateDismissRate(userId, last30Days),
      promotion_ctr: await this.calculatePromotionCTR(userId, last30Days),
      last_purchase_days: await this.getLastPurchaseDays(userId),
      profile_incomplete: user.isCompleted ? 0 : 1,
      hour_of_day: new Date().getHours(),
      is_weekend:
        new Date().getDay() === 6 || new Date().getDay() === 0 ? 1 : 0,
    };

    this.logger.debug(`Features for user ${userId}:`, features);
    return features;
  }

  // FIX: نوع خروجی PartitionedEvent[] است نه PartitionedEvent[]
  private async getUserEvents(userId: number): Promise<PartitionedEvent[]> {
    return this.eventRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 1000,
    });
  }

  // FIX: پارامتر نوع PartitionedEvent[] است نه PartitionedEvent[]
  private async calculateEngagementScore(
    userId: number,
    events: PartitionedEvent[],
  ): Promise<number> {
    if (events.length === 0) return 0;

    const weights: Partial<Record<EventType, number>> = {
      [EventType.LIKE]: 2,
      [EventType.MESSAGE_SENT]: 3,
      [EventType.SUPERLIKE]: 4,
      [EventType.PROFILE_VIEW]: 1,
    };

    let total = 0;
    for (const event of events) {
      total += weights[event.type] ?? 1;
    }

    return Math.min(1, total / 100);
  }

  private async calculateSwipeVelocity(
    userId: number,
    since: Date,
  ): Promise<number> {
    const count = await this.eventRepo.count({
      where: { userId, type: EventType.SKIP, createdAt: MoreThan(since) },
    });
    return count / 7;
  }

  private async calculateDismissRate(
    userId: number,
    since: Date,
  ): Promise<number> {
    const [shown, dismissed] = await Promise.all([
      this.eventRepo.count({
        where: {
          userId,
          type: EventType.PROMOTION_SHOWN,
          createdAt: MoreThan(since),
        },
      }),
      this.eventRepo.count({
        where: {
          userId,
          type: EventType.PROMOTION_DISMISSED,
          createdAt: MoreThan(since),
        },
      }),
    ]);

    if (shown === 0) return 0;
    return Math.min(1, dismissed / shown);
  }

  private async calculatePromotionCTR(
    userId: number,
    since: Date,
  ): Promise<number> {
    const [shown, clicked] = await Promise.all([
      this.eventRepo.count({
        where: {
          userId,
          type: EventType.PROMOTION_SHOWN,
          createdAt: MoreThan(since),
        },
      }),
      this.eventRepo.count({
        where: {
          userId,
          type: EventType.PROMOTION_CLICKED,
          createdAt: MoreThan(since),
        },
      }),
    ]);

    if (shown === 0) return 0;
    return clicked / shown;
  }

  private async getLastPurchaseDays(userId: number): Promise<number> {
    const lastPurchase = await this.eventRepo.findOne({
      where: { userId, type: EventType.PURCHASE },
      order: { createdAt: 'DESC' },
    });

    if (!lastPurchase) return 999;

    return Math.floor(
      (Date.now() - new Date(lastPurchase.createdAt).getTime()) /
        (1000 * 60 * 60 * 24),
    );
  }

}
