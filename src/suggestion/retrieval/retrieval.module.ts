import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VectorSearchService } from './vector-search.service';
import { UserFeatureSnapshot } from '../../feature-store/entities/user-feature.entity';
import { User } from '../../users/entities/user.entity';
import { RedisModule } from '../../redis/redis.module';
import { PersonalityModule } from 'src/personality/personality.module';
import { UserEventModule } from 'src/user-event/user-event.module';
import { FeatureStoreModule } from 'src/feature-store/feature-store.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserFeatureSnapshot, User]),
    RedisModule,
    PersonalityModule,
    UserEventModule,
    FeatureStoreModule,
  ],
  providers: [VectorSearchService],

  exports: [VectorSearchService],
})
export class RetrievalModule {}
