import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AiFeedback } from './entities/ai-feedback.entity';
import { CreateAiFeedbackDto } from './dto/create-ai-feedback.dto';
import { UserEventService } from 'src/user-event/user-event.service';
import { ConversionAnalyticsService } from './services/conversion-analytics.service';
import { Cron } from '@nestjs/schedule';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class AiFeedbackService {
  private readonly logger = new Logger(AiFeedbackService.name);

  constructor(
    @InjectRepository(AiFeedback)
    private repo: Repository<AiFeedback>,
    private readonly userEventService: UserEventService,
    private readonly conversionAnalytics: ConversionAnalyticsService,
    @InjectQueue('ai-feedback') private feedbackQueue: Queue,
    @InjectQueue('conversion-analysis') private conversionQueue: Queue,
  ) {}

  async create(dto: CreateAiFeedbackDto) {
    const saved = await this.repo.save(this.repo.create(dto));

    await Promise.all([
      this.feedbackQueue.add('new_feedback', saved, { attempts: 3 }),
      this.conversionQueue.add('analyze_conversion', {
        feedbackId: saved.id,
        userId: dto.userId,
      }),
      this.userEventService.log({
        userId: dto.userId,
        type: EventType.AI_FEEDBACK_SUBMITTED,
        metadata: {
          feature: dto.feature,
          phase: dto.phase,
          score: dto.value?.score,
          conversionProbability: dto.value?.conversionProbability,
        },
      }),
    ]);

    return saved;
  }

  async getConversionInsights(userId?: number) {
    return this.conversionAnalytics.analyzeConversion(userId);
  }

  async getTopPerformingFeatures() {
    const insights = await this.conversionAnalytics.analyzeConversion();
    return insights.topPerformingFeatures;
  }

  @Cron('0 2 * * *')
  async trainConversionModel() {
    this.logger.log('Starting daily conversion model training...');

    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);

    const feedbacks = await this.repo.find({
      where: { createdAt: MoreThan(last30Days) },
      relations: ['user', 'user.payments'],
    });

    const trainingData = feedbacks.map((f) => ({
      ...f,
      converted: f.user?.payments?.some(
        (p) =>
          p.createdAt > f.createdAt &&
          p.createdAt <
            new Date(f.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000),
      ),
      revenue: f.user?.payments?.reduce((sum, p) => sum + p.amount, 0) || 0,
    }));

    await this.feedbackQueue.add('train_conversion', {
      feedbacks: trainingData,
      timestamp: new Date(),
    });
  }

  async findAll(limit = 100) {
    return this.repo.find({
      take: limit,
      order: { createdAt: 'DESC' },
    });
  }

  async getMetrics() {
    const total = await this.repo.count();
    const avgScore = await this.repo
      .createQueryBuilder('f')
      .select("AVG((f.value->>'score')::float)", 'avg')
      .getRawOne();

    return {
      total,
      averageScore: avgScore?.avg || 0,
    };
  }
}
