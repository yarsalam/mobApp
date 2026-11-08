import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { Personality } from '../entities/personality.entity';
import { Payment } from '../../payments/entities/payment.entity';

export const DEFAULT_PERSONALITY_WEIGHTS: Record<string, number> = {
  openness: 1.0,
  conscientiousness: 1.0,
  extraversion: 1.0,
  agreeableness: 1.0,
  neuroticism: 1.0,
  sentiment_positive: 1.0,
  sentiment_negative: 1.0,
};

const WEIGHT_TTL = 86400 * 30; // 30 روز

@Injectable()
export class PersonalityWeightService {
  private readonly logger = new Logger(PersonalityWeightService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(Personality)
    private readonly personalityRepo: Repository<Personality>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
  ) {}

  async getWeight(key: string): Promise<number> {
    const stored = await this.redis.get(`personality:weight:${key}`);
    return stored
      ? parseFloat(stored)
      : (DEFAULT_PERSONALITY_WEIGHTS[key] ?? 1.0);
  }

  async setWeight(key: string, value: number): Promise<void> {
    await this.redis.set(
      `personality:weight:${key}`,
      value.toString(),
      'EX',
      WEIGHT_TTL,
    );
  }

  // Kept as a callable compatibility method, but deliberately not scheduled:
  // payment status is not a valid basis for changing personality dimensions.
  async pruneWeights(): Promise<void> {
    this.logger.warn(
      'Personality weight pruning is disabled pending validated questionnaire labels and outcome research.',
    );
  }
}
