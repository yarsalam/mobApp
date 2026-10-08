import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { PartitionedEvent } from './entities/partitioned-event.entity';
import { Payment } from '../payments/entities/payment.entity';
import { User } from '../users/entities/user.entity';

import { UserEventService } from './user-event.service';
import { EventIngestionProcessor } from './processors/event-ingestion.processor';

import { ChurnPredictorService } from './analytics/churn-predictor.service';

import { FeatureStoreModule } from '../feature-store/feature-store.module';
import { UserMetricsService } from 'src/user-metrics/user-metrics.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PartitionedEvent, Payment, User]),

    forwardRef(() => FeatureStoreModule),

    BullModule.registerQueue(
      { name: 'event-ingestion' },
      { name: 'event-aggregation' },
      { name: 'cohort-calculation' },
    ),
  ],

  providers: [
    UserEventService,
    UserMetricsService,
    EventIngestionProcessor,
    ChurnPredictorService,
  ],

  exports: [UserEventService, UserMetricsService, ChurnPredictorService],
})
export class UserEventModule {}
