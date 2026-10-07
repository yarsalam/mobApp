import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { PhaseWeights, DEFAULT_WEIGHTS } from '../types/phase.interface';

const WEIGHT_TTL = 86400 * 90; // 90 روز

@Injectable()
export class PhaseWeightService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async getWeight(key: keyof PhaseWeights): Promise<number> {
    const stored = await this.redis.get(`phase:weight:${key}`);
    return stored ? parseFloat(stored) : DEFAULT_WEIGHTS[key];
  }

  async setWeight(key: keyof PhaseWeights, value: number): Promise<void> {
    await this.redis.set(
      `phase:weight:${key}`,
      value.toString(),
      'EX',
      WEIGHT_TTL,
    );
  }

  async getAllWeights(): Promise<PhaseWeights> {
    const keys = Object.keys(DEFAULT_WEIGHTS) as (keyof PhaseWeights)[];
    const values = await Promise.all(keys.map((k) => this.getWeight(k)));
    const partial = Object.fromEntries(keys.map((k, i) => [k, values[i]]));
    return { ...DEFAULT_WEIGHTS, ...partial };
  }
}
