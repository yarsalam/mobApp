import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UserEventModule } from 'src/user-event/user-event.module';
import { FeatureStoreModule } from 'src/feature-store/feature-store.module';
import { RelationStatusModule } from 'src/relation-status/relation-status.module';
import { UserCrudService } from './crud/user-crud.service';
import { UserFilterService } from './filter/user-filter.service';
import { UserAccountService } from './account/user-account.service';
import { UserDiscoveryService } from './discovery/user-discovery.service';
import { UserSimilarityService } from './similarity/user-similarity.service';
import { UserQueryService } from './user-query.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    FeatureStoreModule,
    RelationStatusModule,
    UserEventModule,
  ],
  controllers: [UsersController],
  providers: [
    UserQueryService,
    UsersService,
    UserCrudService, // ← اضافه شد
    UserFilterService, // ← اضافه شد
    UserAccountService, // ← اضافه شد
    UserDiscoveryService, // ← اضافه شد
    UserSimilarityService, // ← اضافه شد
  ],
  exports: [
    UserQueryService,
    UsersService,
    UserCrudService, // ← export تا AuthModule بتواند استفاده کند
    TypeOrmModule,
  ],
})
export class UsersModule {}
