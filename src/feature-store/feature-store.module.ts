import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserFeatureSnapshot } from './entities/user-feature.entity';
import { FeatureStoreService } from './feature-store.service';
import { FeatureStoreController } from './feature-store.controller';

import { PersonalityModule } from '../personality/personality.module';
import { RedisModule } from '../redis/redis.module';
import { User } from '../users/entities/user.entity';
import { UserMetricsModule } from '../user-metrics/user-metrics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserFeatureSnapshot, User]),
    PersonalityModule,
    RedisModule,
    UserMetricsModule,
  ],
  providers: [FeatureStoreService],
  exports: [FeatureStoreService],
  controllers: [FeatureStoreController],
})
export class FeatureStoreModule {}
