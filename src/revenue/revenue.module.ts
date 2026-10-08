import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';

import { User } from '../users/entities/user.entity';
import { Payment } from '../payments/entities/payment.entity';
import { SEOActivity } from '../seo/entities/seo-activity.entity';
import { PartitionedEvent } from '../user-event/entities/partitioned-event.entity';

import { RevenueIntelligenceService } from './revenue-intelligence.service';
import { DecisionEngineService } from './decision-engine.service';
import { RevenueAttributionService } from './revenue-attribution.service';
import { RevenueTrendService } from './revenue-trend.service';

import { RedisModule } from '../redis/redis.module';
import { QueuesModule } from '../queues/queues.module';
import { FeatureStoreRevenueModule } from '../feature-store-rvenue/feature-store-rvenue.module';
import { FeatureStoreModule } from '../feature-store/feature-store.module';

@Module({
  imports: [
    // ---------------------------------------------------------
    // Database
    // ---------------------------------------------------------
    TypeOrmModule.forFeature([User, Payment, SEOActivity, PartitionedEvent]),

    // ---------------------------------------------------------
    // Redis
    // ---------------------------------------------------------
    RedisModule,

    // ---------------------------------------------------------
    // Queue infrastructure
    // ---------------------------------------------------------
    QueuesModule,

    // ---------------------------------------------------------
    // Revenue feature projection
    // ---------------------------------------------------------
    FeatureStoreRevenueModule,

    // ---------------------------------------------------------
    // Canonical Feature Store
    // ---------------------------------------------------------
    FeatureStoreModule,

    // ---------------------------------------------------------
    // HTTP client
    //
    // Required by RevenueAttributionService
    // for communication with ai_revenue.
    // ---------------------------------------------------------
    HttpModule,

    // ---------------------------------------------------------
    // Revenue / ML queues
    // ---------------------------------------------------------
    BullModule.registerQueue(
      {
        name: 'revenue-intelligence',
      },
      {
        name: 'ml-predictions',
      },
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
