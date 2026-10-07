import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { AiFeedback } from '../entities/ai-feedback.entity';
import { User } from 'src/users/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Processor('conversion-analysis')
export class ConversionProcessor extends WorkerHost {
  private readonly logger = new Logger(ConversionProcessor.name);

  constructor(
    @InjectRepository(AiFeedback)
    private readonly feedbackRepo: Repository<AiFeedback>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    const { feedbackId, userId } = job.data;

    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['payments'],
    });

    if (!user) return;

    const feedback = await this.feedbackRepo.findOne({
      where: { id: feedbackId },
    });

    if (!feedback) return;

    const subsequentPurchases = user.payments?.filter(
      (p) => p.createdAt > feedback.createdAt,
    );

    if (subsequentPurchases?.length > 0) {
      feedback.convertedToPurchase = true;
      feedback.timeToConversion = Math.floor(
        (subsequentPurchases[0].createdAt.getTime() -
          feedback.createdAt.getTime()) /
          1000,
      );
      feedback.purchaseMetadata = {
        productId: subsequentPurchases[0].productId,
        productType: subsequentPurchases[0].productType,
        amount: subsequentPurchases[0].amount,
      };

      await this.feedbackRepo.save(feedback);
      this.logger.log(`Feedback ${feedbackId} led to purchase!`);
    }

    return { processed: true };
  }
}
