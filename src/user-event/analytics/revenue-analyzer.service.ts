import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { DailyEventAggregate } from '../aggregates/daily-event-aggregate.entity';
import { UserCohort } from '../aggregates/user-cohort.entity';
import { EventType } from '../type/event-type.enum';

@Injectable()
export class RevenueAnalyzerService {
  private readonly logger = new Logger(RevenueAnalyzerService.name);

  constructor(
    @InjectRepository(DailyEventAggregate)
    private readonly aggregateRepo: Repository<DailyEventAggregate>,
    @InjectRepository(UserCohort)
    private readonly cohortRepo: Repository<UserCohort>,
  ) {}

  async getRevenueMetrics(startDate: Date, endDate: Date) {
    // استفاده از aggregate tables به جای raw events
    const aggregates = await this.aggregateRepo.find({
      where: {
        date: Between(startDate, endDate),
        eventType: EventType.PURCHASE,
      },
    });

    const totalRevenue = aggregates.reduce((sum, a) => sum + a.totalValue, 0);
    const totalPurchases = aggregates.reduce((sum, a) => sum + a.totalCount, 0);
    const uniqueBuyers = aggregates.reduce((sum, a) => sum + a.uniqueUsers, 0);

    return {
      totalRevenue,
      totalPurchases,
      uniqueBuyers,
      averageOrderValue: totalRevenue / totalPurchases,
      revenuePerUser: totalRevenue / uniqueBuyers,
      dailyAverage: totalRevenue / aggregates.length,
    };
  }

  async getRevenueByCohort(cohortDate: Date) {
    const cohorts = await this.cohortRepo.find({
      where: { cohortDate },
      order: { day: 'ASC' },
    });

    return cohorts.map((c) => ({
      day: c.day,
      retentionRate: c.retentionRate,
      estimatedRevenue: c.retainedUsers * 10, // میانگین درآمد هر کاربر
    }));
  }
}
