import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { PartitionedEvent } from '../../../user-event/entities/partitioned-event.entity';
import { SEOMetrics } from '../../entities/seo-metrics.entity';

@Injectable()
export class SEOAnalyticsService {
  private readonly logger = new Logger(SEOAnalyticsService.name);

  constructor(
    // @InjectConnection('analytics')
    @InjectConnection()
    private readonly analyticsConnection: Connection,

    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,

    @InjectRepository(SEOMetrics)
    private readonly metricsRepo: Repository<SEOMetrics>,
  ) {}

  async getLTVCohorts() {
    return this.analyticsConnection.query(`
      SELECT
        acquisition_source,
        AVG(ltv) as avg_ltv,
        COUNT(*) as user_count
      FROM analytics.user_cohorts
      GROUP BY acquisition_source
    `);
  }

  @Cron('0 2 * * *') // هر روز ساعت ۲ صبح
  async syncToWarehouse() {
    this.logger.log('Syncing events to analytics warehouse...');

    const events = await this.eventRepo.find({
      where: {
        createdAt: MoreThan(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      },
    });

    for (const event of events) {
      await this.analyticsConnection.query(
        'INSERT IGNORE INTO analytics.partitioned_events (id, user_id, type, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
        [event.id, event.userId, event.type, event.metadata, event.createdAt],
      );
    }

    this.logger.log(`Synced ${events.length} events`);
  }
}
