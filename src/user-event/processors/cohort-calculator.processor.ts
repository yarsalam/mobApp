import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { PartitionedEvent } from '../entities/partitioned-event.entity';
import { UserCohort } from '../aggregates/user-cohort.entity';

@Processor('cohort-calculation')
@Injectable()
export class CohortCalculatorProcessor extends WorkerHost {
  private readonly logger = new Logger(CohortCalculatorProcessor.name);

  constructor(
    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,
    @InjectRepository(UserCohort)
    private readonly cohortRepo: Repository<UserCohort>,
    private readonly entityManager: EntityManager,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    const { cohortDate } = job.data;
    const startTime = Date.now();

    this.logger.log(`Starting cohort calculation for ${cohortDate}`);

    // FIX: کوئری برای MySQL بازنویسی شد.
    // تغییرات:
    //   1) placeholder $1 → ?
    //   2) EXTRACT(DAY FROM ...)::INTEGER → DATEDIFF(...)
    //   3) DATE($1) + INTERVAL '30 days' → DATE_ADD(?, INTERVAL 30 DAY)
    //   4) مقادیر enum اصلاح شد: 'USER_REGISTERED'/'APP_OPEN' → 'user_registered'/'app_open'
    //      (مقدار واقعی enum با حروف کوچک است؛ مقدار اشتباه باعث می‌شد کوئری همیشه صفر برگرداند)
    const results = await this.entityManager.query(
      `
      WITH new_users AS (
        SELECT DISTINCT user_id
        FROM user_events
        WHERE type = 'user_registered'
          AND DATE(created_at) = ?
      ),
      retention_data AS (
        SELECT 
          nu.user_id,
          DATEDIFF(e.created_at, ?) AS day
        FROM new_users nu
        JOIN user_events e ON e.user_id = nu.user_id
        WHERE e.type = 'app_open'
          AND e.created_at > ?
          AND e.created_at <= DATE_ADD(?, INTERVAL 30 DAY)
        GROUP BY nu.user_id, day
      )
      SELECT 
        day,
        COUNT(DISTINCT user_id) AS retained_users,
        (SELECT COUNT(*) FROM new_users) AS total_users
      FROM retention_data
      GROUP BY day
      ORDER BY day
    `,
      [cohortDate, cohortDate, cohortDate, cohortDate],
    );

    const totalUsers = results[0]?.total_users || 0;

    if (totalUsers === 0) {
      this.logger.log(`No new users for ${cohortDate}`);
      return { cohortDate, users: 0 };
    }

    // ذخیره نتایج
    const cohorts: UserCohort[] = [];
    for (const row of results) {
      if (row.day) {
        // فقط روزهای 1, 7, 30
        const cohort = this.cohortRepo.create({
          cohortDate: new Date(cohortDate),
          day: row.day,
          totalUsers,
          retainedUsers: parseInt(row.retained_users),
          retentionRate: parseFloat(row.retained_users) / totalUsers,
        });
        cohorts.push(cohort);
      }
    }

    if (cohorts.length > 0) {
      await this.cohortRepo.save(cohorts);
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `✅ Cohort calculated for ${cohortDate}: ${totalUsers} users in ${duration}ms`,
    );

    return { cohortDate, users: totalUsers, duration };
  }
}
