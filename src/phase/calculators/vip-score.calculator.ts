import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from '../../message/entities/message.entity';
import { InteractionsService } from '../../interaction/interaction.service';
import { UserMetricsService } from '../../user-metrics/user-metrics.service';
import { User } from 'src/users/entities/user.entity';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class VipScoreCalculator {
  constructor(
    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,

    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly interactionsService: InteractionsService,
    private readonly metricsService: UserMetricsService,
  ) {}

  async calculateLearningScore(userId: number): Promise<number> {
    const [events, interactions, messages] = await Promise.all([
      this.eventRepo.find({ where: { userId }, take: 100 }),
      this.interactionsService.getUserInteractions(userId),
      this.messageRepo.find({
        where: { from_id: userId },
        order: { created_at: 'DESC' },
        take: 200,
        select: ['content'],
      }),
    ]);

    const usedFeatures = new Set(events.map((e) => e.type));
    const featureDiversity = Math.min(usedFeatures.size / 10, 1) * 100;

    const likes = interactions.filter((i) => i.type === 'like').length;
    const matchCount = await this.eventRepo.count({
      where: { userId, type: EventType.MATCH },
    });
    const likeToMatchRate = likes > 0 ? (matchCount / likes) * 100 : 0;

    const totalLength = messages.reduce(
      (sum, m) => sum + (m.content?.length ?? 0),
      0,
    );
    const avgLength = messages.length > 0 ? totalLength / messages.length : 0;
    const messageDepth = Math.min((avgLength / 100) * 100, 100);

    const slope = await this.metricsService.getEngagementSlope(userId);

    // guidanceCompletion: نسبت event های راهنما به کل
    const guidanceEvents = events.filter((e) =>
      ['profile_view', 'help_opened', 'tutorial_step'].includes(e.type),
    ).length;
    const guidanceCompletion = Math.min(guidanceEvents / 5, 1);

    return (
      Math.round(
        (featureDiversity * 0.25 +
          likeToMatchRate * 0.25 +
          messageDepth * 0.2 +
          guidanceCompletion * 0.2 +
          slope * 0.1) *
          100,
      ) / 100
    );
  }

  async getProfileCompleteness(userId: number): Promise<number> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: [
        'id',
        'nickname',
        'gender',
        'city',
        'birth_year',
        'aboutme',
        'hobbies_self',
        'values_self',
        'isFaceVerified',
        'education',
        'marital',
      ],
    });
    if (!user) return 0;

    const fields = [
      !!user.nickname,
      !!user.gender,
      !!user.city,
      !!user.birth_year,
      (user.aboutme?.length ?? 0) > 20,
      (user.hobbies_self?.length ?? 0) > 0,
      (user.values_self?.length ?? 0) > 0,
      !!user.isFaceVerified,
      !!user.education,
      !!user.marital,
    ];

    const filled = fields.filter(Boolean).length;
    return Math.round((filled / fields.length) * 100) / 100;
  }

  async getSentimentScore(userId: number): Promise<number> {
    const interactions =
      await this.interactionsService.getUserInteractions(userId);
    if (!interactions.length) return 0.5;

    const positive = interactions.filter(
      (i) => i.type === 'like' || i.type === 'superlike',
    ).length;
    const negative = interactions.filter((i) => i.type === 'skip').length;

    const total = positive + negative;
    if (total === 0) return 0.5;

    // normalize بین 0.2 و 0.9
    const raw = positive / total;
    return Math.round((0.2 + raw * 0.7) * 100) / 100;
  }

  // ✅ N+1 fix: learningScore یک‌بار محاسبه می‌شود و پاس داده می‌شود
  async calculateVipScores(
    userId: number,
    weights: any,
    precomputedLearningScore?: number,
  ): Promise<{ learning: number; profile: number; sentiment: number }> {
    const [learningScore, profileCompleteness, sentimentScore] =
      await Promise.all([
        precomputedLearningScore !== undefined
          ? Promise.resolve(precomputedLearningScore)
          : this.calculateLearningScore(userId),
        this.getProfileCompleteness(userId),
        this.getSentimentScore(userId),
      ]);

    return {
      learning: learningScore * (weights.learningScore || 0),
      profile: profileCompleteness * (weights.profileCompleteness || 0),
      sentiment: sentimentScore * (weights.sentimentScore || 0),
    };
  }
}
