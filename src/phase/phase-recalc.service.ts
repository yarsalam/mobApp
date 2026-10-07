import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { Repository, MoreThan, LessThan } from 'typeorm';
import { PhaseService } from './phase.service';
import { Cron } from '@nestjs/schedule';
import { UserPhase } from './entities/user-phase.entity';

// حداکثر همزمانی برای جلوگیری از DB overload
const RECALC_CONCURRENCY = 10;

@Injectable()
export class PhaseRecalcService {
  private readonly logger = new Logger(PhaseRecalcService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(UserPhase)
    private readonly phaseRepo: Repository<UserPhase>,

    private readonly phaseService: PhaseService,
  ) {}

  @Cron('0 3 * * *')
  async recalcAllPhases() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const users = await this.userRepo.find({
      where: { lastActive: MoreThan(thirtyDaysAgo) },
      select: ['id'],
    });

    this.logger.log(`Recalculating phases for ${users.length} active users`);

    // پردازش Batch برای جلوگیری از N+1 و DB meltdown
    for (let i = 0; i < users.length; i += RECALC_CONCURRENCY) {
      const batch = users.slice(i, i + RECALC_CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (user) => {
          try {
            await this.phaseService.calculate(user.id);
          } catch (error: unknown) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Phase calculation failed for user ${user.id}: ${message}`,
            );
          }
        }),
      );
      // مکث کوتاه بین batch‌ها
      if (i + RECALC_CONCURRENCY < users.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    this.logger.log('Phase recalculation complete');
  }

  @Cron('0 2 * * *')
  async detectChurnUsers() {
    const inactiveUsers = await this.phaseRepo.find({
      where: { score: LessThan(10) },
    });

    this.logger.log(
      `Detecting churn for ${inactiveUsers.length} low-score users`,
    );

    for (let i = 0; i < inactiveUsers.length; i += RECALC_CONCURRENCY) {
      const batch = inactiveUsers.slice(i, i + RECALC_CONCURRENCY);
      await Promise.allSettled(
        batch.map((u) =>
          this.phaseService.learnFromFeedback(u.userId, 'churn'),
        ),
      );
    }
  }
}
