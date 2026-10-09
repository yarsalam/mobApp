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
import { UserMetricsModule } from '../user-metrics/user-metrics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PartitionedEvent, Payment, User]),

    forwardRef(() => FeatureStoreModule),
    UserMetricsModule,

    BullModule.registerQueue(
      { name: 'event-ingestion' },
      { name: 'event-aggregation' },
      { name: 'cohort-calculation' },
    ),
  ],

  providers: [UserEventService, EventIngestionProcessor, ChurnPredictorService],

  exports: [UserEventService, UserMetricsModule, ChurnPredictorService],
})
export class UserEventModule {}
