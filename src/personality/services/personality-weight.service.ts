import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { Personality } from '../entities/personality.entity';
import { Payment } from '../../payments/entities/payment.entity';
import { Cron } from '@nestjs/schedule';

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

  @Cron('0 5 * * 0') // یکشنبه‌ها
  async pruneWeights(): Promise<void> {
    this.logger.log('Pruning personality weights...');

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const payingUsers = await this.paymentRepo
      .createQueryBuilder('p')
      .select('DISTINCT p.userId', 'userId')
      .where('p.createdAt > :date', { date: thirtyDaysAgo })
      .andWhere('p.status = :status', { status: 'paid' })
      .getRawMany();

    const paidUserIds = payingUsers.map((u: any) => Number(u.userId));
    if (paidUserIds.length < 20) {
      this.logger.warn('Not enough paying users to prune weights');
      return;
    }

    const features = Object.keys(DEFAULT_PERSONALITY_WEIGHTS).filter(
      (f) => !f.startsWith('sentiment'),
    );
    const personalities = await this.personalityRepo
      .createQueryBuilder('p')
      .where('p.userId IN (:...ids)', { ids: paidUserIds.slice(0, 200) })
      .getMany();

    const avgWeights: Record<string, number> = {};
    for (const f of features) {
      let sum = 0,
        count = 0;
      for (const p of personalities) {
        const val = (p as any)[f] ?? p.ocean?.[f];
        if (val !== undefined && val !== null) {
          sum += val;
          count++;
        }
      }
      avgWeights[f] = count > 0 ? sum / count : 0.5;
    }

    for (const f of features) {
      const current = await this.getWeight(f);
      const avg = avgWeights[f] ?? 0.5;
      if (avg < 0.4 && current > 0.2) {
        const newVal = Math.max(0.1, current - 0.05);
        await this.setWeight(f, newVal);
        this.logger.log(
          `Pruned "${f}": ${current.toFixed(2)} → ${newVal.toFixed(2)} (avg in payers: ${avg.toFixed(2)})`,
        );
      }
    }
  }
}
