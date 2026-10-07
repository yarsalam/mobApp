import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PhaseWeightService } from './phase-weight.service';
import { FeatureStoreService } from '../../feature-store/feature-store.service';
import { PhaseWeights } from '../types/phase.interface';
import { RevenueAttributionService } from 'src/revenue/revenue-attribution.service';

@Injectable()
export class PhaseLearningService {
  private readonly logger = new Logger(PhaseLearningService.name);
  private readonly rewardMap: Record<string, number> = {
    purchase: 2,
    match: 0.5,
    message: 0.3,
    boost_used: 0.4,
    churn: -1,
    profile_completed: 1.5,
  };
  private readonly targetWeightMap: Record<string, keyof PhaseWeights> = {
    match: 'matches',
    message: 'messages',
    boost_used: 'boostUsed',
    churn: 'retentionDays',
    profile_completed: 'profileCompleteness',
  };

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly weightService: PhaseWeightService,
    private readonly featureStore: FeatureStoreService,
    private readonly revenueAttribution: RevenueAttributionService,
  ) {}

  async learnFromFeedback(
    userId: number,
    event:
      | 'purchase'
      | 'match'
      | 'message'
      | 'boost_used'
      | 'churn'
      | 'profile_completed',
    context?: { amount?: number; productType?: string },
  ): Promise<void> {
    if (event === 'churn') {
      const user = await this.userRepo.findOneBy({ id: userId });
      if (user) {
        const source = user.metadata?.acquisitionSource || 'organic';
        await this.revenueAttribution.adjustSourceWeight(source, -0.5);
      }
    }

    const baseReward = this.rewardMap[event] ?? 0;
    const reward =
      context?.amount && context.amount > 100 ? baseReward * 1.5 : baseReward;
    const targetWeight = this.targetWeightMap[event];
    if (!targetWeight || reward === 0) return;

    const currentWeight = await this.weightService.getWeight(targetWeight);
    const learningRate = 0.01;
    const newWeight = Math.max(
      0.1,
      Math.min(10, currentWeight + learningRate * reward),
    );

    await this.weightService.setWeight(targetWeight, newWeight);

    if (['purchase', 'match', 'message', 'profile_completed'].includes(event)) {
      await this.featureStore.learnFeatureWeights(userId, event as any);
    }

    this.logger.log(
      `Weight "${targetWeight}" adjusted: ${currentWeight.toFixed(2)} → ${newWeight.toFixed(2)} (event: ${event})`,
    );
  }
}
