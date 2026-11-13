import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ProductBundle } from '../product/entities/product-bundle.entity';
import { User } from '../users/entities/user.entity';
import { PartitionedEvent } from '../user-event/entities/partitioned-event.entity';
import { UserEventModule } from '../user-event/user-event.module';
import { RedisModule } from '../redis/redis.module';
import { PricingExperimentService } from './pricing-experiment.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductBundle, User, PartitionedEvent]),
    UserEventModule,
    RedisModule,
  ],
  providers: [PricingExperimentService],
  exports: [PricingExperimentService],
})
export class PricingExperimentModule {}
