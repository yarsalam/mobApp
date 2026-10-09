import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserFeatureSnapshot } from './entities/user-feature.entity';
import { FeatureStoreService } from './feature-store.service';
import { FeatureStoreController } from './feature-store.controller';

import { PersonalityModule } from '../personality/personality.module';
import { RedisModule } from '../redis/redis.module';
import { User } from '../users/entities/user.entity';
import { UserMetricsModule } from '../user-metrics/user-metrics.module';
import { FeatureWeightState } from './entities/feature-weight-state.entity';
import { FeatureLearningReceipt } from './entities/feature-learning-receipt.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserFeatureSnapshot,
      User,
      FeatureLearningReceipt,
      FeatureWeightState,
    ]),
    PersonalityModule,
    RedisModule,
    UserMetricsModule,
  ],
  providers: [FeatureStoreService],
  exports: [FeatureStoreService],
  controllers: [FeatureStoreController],
})
export class FeatureStoreModule {}
