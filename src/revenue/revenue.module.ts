import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { User } from '../users/entities/user.entity';
import { Payment } from '../payments/entities/payment.entity';
import { SEOActivity } from '../seo/entities/seo-activity.entity';
import { PartitionedEvent } from '../user-event/entities/partitioned-event.entity';
import { RevenueIntelligenceService } from './revenue-intelligence.service';
import { DecisionEngineService } from './decision-engine.service';
import { RedisModule } from '../redis/redis.module';
import { QueuesModule } from '../queues/queues.module';
import { FeatureStoreRevenueModule } from '../feature-store-rvenue/feature-store-rvenue.module';
import { RevenueAttributionService } from './revenue-attribution.service';
import { HttpModule } from '@nestjs/axios';
import { FeatureStoreModule } from 'src/feature-store/feature-store.module';
import { RevenueTrendService } from './revenue-trend.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Payment, SEOActivity, PartitionedEvent]),
    QueuesModule,
    RedisModule,
    FeatureStoreRevenueModule,
    FeatureStoreModule,
    HttpModule,
    BullModule.registerQueue(
      { name: 'revenue-intelligence' },
      { name: 'ml-predictions' },
    ),
  ],
  providers: [
    RevenueIntelligenceService,
    DecisionEngineService,
    RevenueAttributionService,
    RevenueTrendService,
  ],
  exports: [
    RevenueIntelligenceService,
    DecisionEngineService,
    RevenueAttributionService,
    RevenueTrendService,
  ],
})
export class RevenueModule {}
