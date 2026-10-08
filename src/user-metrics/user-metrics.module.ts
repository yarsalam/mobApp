import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Payment } from '../payments/entities/payment.entity';
import { User } from '../users/entities/user.entity';
import { Message } from '../message/entities/message.entity';

import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';

import { UserMetricsService } from './user-metrics.service';
import { FeatureService } from './feature.service';
import { DailyMetricsService } from './daily-metrics.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, User, Message, PartitionedEvent]),
  ],

  providers: [UserMetricsService, FeatureService, DailyMetricsService],

  exports: [UserMetricsService, FeatureService],
})
export class UserMetricsModule {}
