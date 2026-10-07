import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { User } from 'src/users/entities/user.entity';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { UserCohort } from 'src/user-event/aggregates/user-cohort.entity';
import { EventType } from 'src/user-event/type/event-type.enum';
import { ChurnPredictorService } from 'src/user-event/analytics/churn-predictor.service';

interface TimeToFirstEventResult {
  avgHours: number | null;
  medianHours: number | null;
  sampleSize: number;
}

@Controller('admin-api/users')
@UseGuards(AdminApiGuard)
export class UsersIntelligenceController {
  constructor(
    private readonly churnPredictor: ChurnPredictorService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,
    @InjectRepository(UserCohort)
    private readonly cohortRepo: Repository<UserCohort>,
  ) {}

  // ── Churn ──────────────────────────────────────────────────────────────

  @Get('churn/at-risk')
  async getAtRisk(
    @Query('threshold') threshold?: string,
    @Query('limit') limit?: string,
  ) {
    const t = Math.min(Math.max(Number(threshold) || 0.7, 0), 1);
    const l = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.churnPredictor.getAtRiskUsers(t, l);
  }

  @Get('churn/summary')
  async getChurnSummary() {
    return this.churnPredictor.getChurnSummary();
  }

  // ── Cohorts (جدول user_cohorts که هفتگی توسط CohortCalculatorProcessor پر می‌شه) ──

  @Get('cohorts')
  async getCohorts(@Query('weeks') weeks?: string) {
    const w = Math.min(Math.max(Number(weeks) || 8, 1), 52);
    const since = new Date();
    since.setDate(since.getDate() - w * 7);

    const rows = await this.cohortRepo.find({
      where: { cohortDate: MoreThanOrEqual(since) },
      order: { cohortDate: 'DESC', day: 'ASC' },
    });

    const grouped = new Map<
      string,
      {
        day: number;
        retentionRate: number;
        totalUsers: number;
        retainedUsers: number;
      }[]
    >();
    for (const r of rows) {
      const key = String(r.cohortDate);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push({
        day: r.day,
        retentionRate: r.retentionRate,
        totalUsers: r.totalUsers,
        retainedUsers: r.retainedUsers,
      });
    }

    return Array.from(grouped.entries()).map(([cohortDate, points]) => ({
      cohortDate,
      points: points.sort((a, b) => a.day - b.day),
    }));
  }

  // ── سرعت شروع تعامل ────────────────────────────────────────────────────

  @Get('time-to-first-match')
  async timeToFirstMatch(@Query('days') days?: string) {
    return this.computeTimeToFirstEvent(EventType.MATCH, this.clampDays(days));
  }

  @Get('time-to-first-conversation')
  async timeToFirstConversation(@Query('days') days?: string) {
    // «مکالمه» با اولین پیام ارسالی کاربر تقریب زده می‌شه؛ محاسبه‌ی دقیق
    // «اولین مکالمه‌ی دوطرفه‌ی معنادار» (تعریف meaningfulConversations در
    // IntelligenceSnapshotController) گران‌تره — اگه لازم شد بعداً ارتقا بده.
    return this.computeTimeToFirstEvent(
      EventType.MESSAGE_SENT,
      this.clampDays(days),
    );
  }

  private clampDays(raw?: string): number {
    return Math.min(Math.max(Number(raw) || 30, 1), 180);
  }

  private async computeTimeToFirstEvent(
    eventType: EventType,
    days: number,
  ): Promise<TimeToFirstEventResult> {
    const since = new Date(Date.now() - days * 86_400_000);

    const cohortUsers = await this.userRepo.find({
      where: { createdAt: MoreThanOrEqual(since) },
      select: ['id', 'createdAt'],
    });
    if (cohortUsers.length === 0) {
      return { avgHours: null, medianHours: null, sampleSize: 0 };
    }
    const signupMap = new Map(cohortUsers.map((u) => [u.id, u.createdAt]));

    const firstEvents = await this.eventRepo
      .createQueryBuilder('e')
      .select('e.userId', 'userId')
      .addSelect('MIN(e.createdAt)', 'firstAt')
      .where('e.type = :eventType', { eventType })
      .andWhere('e.userId IN (:...ids)', {
        ids: cohortUsers.map((u) => u.id),
      })
      .groupBy('e.userId')
      .getRawMany<{ userId: number; firstAt: Date }>();

    const hoursList: number[] = [];
    for (const row of firstEvents) {
      const signupAt = signupMap.get(Number(row.userId));
      if (!signupAt) continue;
      const diffHours =
        (new Date(row.firstAt).getTime() - new Date(signupAt).getTime()) /
        3_600_000;
      if (diffHours >= 0) hoursList.push(diffHours);
    }

    if (hoursList.length === 0) {
      return { avgHours: null, medianHours: null, sampleSize: 0 };
    }

    hoursList.sort((a, b) => a - b);
    const avgHours = hoursList.reduce((s, h) => s + h, 0) / hoursList.length;
    const mid = Math.floor(hoursList.length / 2);
    const medianHours =
      hoursList.length % 2 === 0
        ? (hoursList[mid - 1] + hoursList[mid]) / 2
        : hoursList[mid];

    return {
      avgHours: Math.round(avgHours * 10) / 10,
      medianHours: Math.round(medianHours * 10) / 10,
      sampleSize: hoursList.length,
    };
  }
}
