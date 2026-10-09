import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserFeatureSnapshot } from './entities/user-feature.entity';
import { FeatureStoreService } from './feature-store.service';
import { FeatureStoreController } from './feature-store.controller';
import { SemanticEmbeddingService } from './semantic-embedding.service';

import { PersonalityModule } from '../personality/personality.module';
import { RedisModule } from '../redis/redis.module';
import { User } from '../users/entities/user.entity';
import { UserMetricsModule } from '../user-metrics/user-metrics.module';
import { AiModule } from '../ai/ai.module';
import { FeatureLearningReceipt } from './entities/feature-learning-receipt.entity';
import { FeatureWeightState } from './entities/feature-weight-state.entity';

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
    AiModule,
  ],
  providers: [FeatureStoreService, SemanticEmbeddingService],
  exports: [FeatureStoreService, SemanticEmbeddingService],
  controllers: [FeatureStoreController],
})
export class FeatureStoreModule {}
