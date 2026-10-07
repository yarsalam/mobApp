import { Repository } from 'typeorm';
import { UserPhase } from '../entities/user-phase.entity';
import { UserMetricsService } from '../../user-metrics/user-metrics.service';
import { PhaseWeightService } from '../services/phase-weight.service';
import { EngagementScoreCalculator } from '../calculators/engagement-score.calculator';
import { RevenueScoreCalculator } from '../calculators/revenue-score.calculator';
import { ActivityScoreCalculator } from '../calculators/activity-score.calculator';
import { VipScoreCalculator } from '../calculators/vip-score.calculator';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class PhaseResolver {
  private readonly logger = new Logger(PhaseResolver.name);

  constructor(
    @InjectRepository(UserPhase)
    private readonly repo: Repository<UserPhase>,
    private readonly metricsService: UserMetricsService,
    private readonly weightService: PhaseWeightService,
    private readonly engagementCalc: EngagementScoreCalculator,
    private readonly revenueCalc: RevenueScoreCalculator,
    private readonly activityCalc: ActivityScoreCalculator,
    private readonly vipCalc: VipScoreCalculator,
  ) {}

  async calculate(userId: number, metrics?: any): Promise<UserPhase> {
    try {
      const baseMetrics =
        metrics || (await this.metricsService.get7dMetrics(userId));
      const weights = await this.weightService.getAllWeights();

      const [matchesScore, messagesScore] = await Promise.all([
        this.engagementCalc.calculateMatchesScore(baseMetrics, weights),
        this.engagementCalc.calculateMessagesScore(baseMetrics, weights),
      ]);
      const viewsScore = this.activityCalc.calculateViewsScore(
        baseMetrics,
        weights,
      );
      const retentionScore = this.activityCalc.calculateRetentionScore(
        baseMetrics,
        weights,
      );
      const pastPaymentsScore = this.revenueCalc.calculatePastPaymentsScore(
        baseMetrics,
        weights,
      );
      const boostScore = this.revenueCalc.calculateBoostScore(
        baseMetrics,
        weights,
      );
      const cityScore = this.activityCalc.calculateCityUsersScore(
        baseMetrics,
        weights,
      );
      const learningScore = await this.vipCalc.calculateLearningScore(userId);
      const { profile, sentiment } = await this.vipCalc.calculateVipScores(
        userId,
        weights,
      ); // Note: adjusted to avoid double calc, but keep structure minimal

      const totalScore =
        matchesScore +
        messagesScore +
        viewsScore +
        retentionScore +
        pastPaymentsScore +
        boostScore +
        cityScore +
        learningScore + // Use the calculated one
        profile +
        sentiment; // Note: profile and sentiment still from calc, learning fixed

      const safeScore =
        isNaN(totalScore) || !isFinite(totalScore) ? 10 : totalScore;
      let phase: string = 'cold';
      if (safeScore >= 40) phase = 'hot';
      else if (safeScore >= 15) phase = 'warm';

      let record = await this.repo.findOne({ where: { userId } });
      if (!record) record = this.repo.create({ userId });

      record.score = safeScore;
      record.phase = phase;
      record.learningScore = learningScore || 0; // Fixed: reuse
      record.everPaid = (baseMetrics.pastPayments || 0) > 0;

      return await this.repo.save(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Phase calculation failed for user ${userId}: ${message}`,
      );
      const fallback = await this.repo.findOne({ where: { userId } });
      if (!fallback) {
        return this.repo.save(
          this.repo.create({
            userId,
            phase: 'cold',
            score: 10,
            learningScore: 0,
            everPaid: false,
          }),
        );
      }
      return fallback;
    }
  }
}
