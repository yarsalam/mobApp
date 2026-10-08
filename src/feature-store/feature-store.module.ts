import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserFeatureSnapshot } from './entities/user-feature.entity';
import { FeatureStoreService } from './feature-store.service';
import { FeatureStoreController } from './feature-store.controller';

import { PersonalityModule } from '../personality/personality.module';
import { UserEventModule } from '../user-event/user-event.module';
import { RedisModule } from '../redis/redis.module';

import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserFeatureSnapshot, User]),

    PersonalityModule,

    // FeatureStoreModule <-> UserEventModule
    // circular dependency
    forwardRef(() => UserEventModule),

    RedisModule,
  ],

  providers: [FeatureStoreService],

  exports: [FeatureStoreService],

  controllers: [FeatureStoreController],
})
export class FeatureStoreModule {}
