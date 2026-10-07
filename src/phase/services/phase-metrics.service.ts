import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { UserPhase } from '../entities/user-phase.entity';

@Injectable()
export class PhaseMetricsService {
  constructor(
    @InjectRepository(UserPhase)
    private readonly repo: Repository<UserPhase>,
  ) {}

  private getNextPhaseThreshold(currentPhase: string): number {
    return currentPhase === 'cold' ? 15 : currentPhase === 'warm' ? 40 : 0;
  }

  private getSuggestedActions(phase: string, everPaid: boolean): string[] {
    const actions: string[] = [];
    switch (phase) {
      case 'cold':
        actions.push(
          'پروفایل خود را کامل کنید',
          'از بوست رایگان استفاده کنید',
          'عکس پروفایل باکیفیت آپلود کنید',
        );
        break;
      case 'warm':
        actions.push('برای شروع گفتگو اعتبار بخرید', 'با بوست بیشتر دیده شوید');
        if (!everPaid) actions.push('اولین خرید با تخفیف ویژه');
        break;
      case 'hot':
        actions.push(
          'VIP شوید و لایک نامحدود داشته باشید',
          'سوپرلایک روزانه رایگان',
        );
        break;
    }
    return actions;
  }

  private async calculatePercentile(score: number): Promise<number> {
    const total = await this.repo.count();
    if (total === 0) return 0;
    const less = await this.repo.count({ where: { score: LessThan(score) } });
    return Math.round((less / total) * 100);
  }

  async getPhaseMetrics(userId: number): Promise<any> {
    const phase = await this.repo.findOne({ where: { userId } });
    if (!phase) {
      return {
        phase: 'cold',
        score: 10,
        learningScore: 0,
        everPaid: false,
        percentile: 0,
        nextPhaseThreshold: 15,
        suggestedActions: this.getSuggestedActions('cold', false),
      };
    }
    return {
      phase: phase.phase,
      score: phase.score,
      learningScore: phase.learningScore,
      everPaid: phase.everPaid,
      percentile: await this.calculatePercentile(phase.score),
      nextPhaseThreshold: this.getNextPhaseThreshold(phase.phase),
      suggestedActions: this.getSuggestedActions(phase.phase, phase.everPaid),
    };
  }

  async getPhaseDistribution(): Promise<{
    cold: number;
    warm: number;
    hot: number;
  }> {
    const total = await this.repo.count();
    if (total === 0) return { cold: 0, warm: 0, hot: 0 };
    const [cold, warm, hot] = await Promise.all([
      this.repo.count({ where: { phase: 'cold' } }),
      this.repo.count({ where: { phase: 'warm' } }),
      this.repo.count({ where: { phase: 'hot' } }),
    ]);
    return {
      cold: Math.round((cold / total) * 100),
      warm: Math.round((warm / total) * 100),
      hot: Math.round((hot / total) * 100),
    };
  }
}
