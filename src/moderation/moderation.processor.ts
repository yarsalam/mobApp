import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModerationLog } from './entities/moderation-log.entity';
import { User } from '../users/entities/user.entity';

@Processor('moderation')
export class ModerationProcessor extends WorkerHost {
  private readonly logger = new Logger(ModerationProcessor.name);

  constructor(
    @InjectRepository(ModerationLog)
    private logRepo: Repository<ModerationLog>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private httpService: HttpService,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    switch (job.name) {
      case 'process-later':
        return this.processLater(job.data);
      case 'moderate-async':
        return this.moderateAsync(job.data);
      case 'update-trust-scores':
        return this.updateTrustScores();
      default:
        this.logger.warn(`Unknown job: ${job.name}`);
    }
  }

  private async processLater(data: any) {
    this.logger.log(`Processing delayed message from user ${data.senderId}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(`${process.env.AI_MODERATION_URL}/moderate`, {
          text: data.message,
          sender_id: data.senderId,
          receiver_id: data.receiverId,
        }),
      );

      const result = response.data;

      if (!result.is_safe) {
        await this.userRepo
          .createQueryBuilder()
          .update(User)
          .set({
            trustScore: () => 'GREATEST(0, LEAST(100, "trustScore" - 20))',
            restrictedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
          })
          .where('id = :id', { id: data.senderId })
          .execute();
        this.logger.warn(
          `User ${data.senderId} restricted after delayed processing`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Delayed processing failed: ${message}`);
    }
  }

  private async moderateAsync(data: any) {
    // TODO: پیاده‌سازی
  }

  private async updateTrustScores() {
    this.logger.log('Updating trust scores...');

    // Query درست با QueryBuilder
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const usersWithViolations = await this.logRepo
      .createQueryBuilder('log')
      .select('log.userId', 'userId')
      .addSelect('COUNT(*)', 'violationCount')
      .where('log.createdAt > :date', { date: sevenDaysAgo })
      .andWhere('log.isSafe = false')
      .groupBy('log.userId')
      .getRawMany();

    for (const row of usersWithViolations) {
      const delta = -Math.min(row.violationCount * 5, 30);
      await this.userRepo
        .createQueryBuilder()
        .update(User)
        .set({
          trustScore: () => `GREATEST(0, LEAST(100, "trustScore" + ${delta}))`,
        })
        .where('id = :id', { id: row.userId })
        .execute();
    }

    this.logger.log(
      `Updated trust scores for ${usersWithViolations.length} users`,
    );
  }
}
