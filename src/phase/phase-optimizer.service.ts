import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { UserPhase } from './entities/user-phase.entity';
import { Payment } from '../payments/entities/payment.entity';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class PhaseOptimizerService {
  private readonly logger = new Logger(PhaseOptimizerService.name);

  constructor(
    @InjectRepository(UserPhase)
    private readonly phaseRepo: Repository<UserPhase>,

    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,

    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('0 4 * * 0') // هر یکشنبه
  async analyzeWeightEffectiveness() {
    this.logger.log('Analyzing weight effectiveness...');

    const [users, payments] = await Promise.all([
      this.phaseRepo.find({ take: 500 }),
      this.paymentRepo.find({
        where: { createdAt: MoreThan(new Date(Date.now() - 30 * 86400000)) },
        select: ['userId'],
      }),
    ]);

    const userIdsWithPurchase = new Set(payments.map((p) => p.userId));

    const buyerScores: number[] = [];
    const nonBuyerScores: number[] = [];

    for (const user of users) {
      if (userIdsWithPurchase.has(user.userId)) {
        buyerScores.push(user.score);
      } else {
        nonBuyerScores.push(user.score);
      }
    }

    const buyerAvg =
      buyerScores.length > 0
        ? buyerScores.reduce((a, b) => a + b, 0) / buyerScores.length
        : 0;
    const nonBuyerAvg =
      nonBuyerScores.length > 0
        ? nonBuyerScores.reduce((a, b) => a + b, 0) / nonBuyerScores.length
        : 0;

    this.logger.log(
      `Buyer avg score: ${buyerAvg.toFixed(2)}, Non-buyer avg: ${nonBuyerAvg.toFixed(2)}`,
    );

    // اگر امتیاز خریداران به مراتب بالاتر است — وزن‌ها مؤثر هستند
    const isEffective = buyerAvg > nonBuyerAvg * 1.2;

    if (!isEffective) {
      this.logger.warn(
        'Phase weights may not be effective enough for purchase prediction',
      );
    }
  }
}
