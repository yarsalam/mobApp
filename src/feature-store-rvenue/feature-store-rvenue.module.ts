import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../payments/entities/payment.entity';
import { FeatureStoreRevenueService } from './feature-store-rvenue.service';
import { User } from 'src/users/entities/user.entity';
import { SEOActivity } from 'src/seo/entities/seo-activity.entity';
import { ExternalSEOToolsService } from 'src/seo/services/external-seo-tools.service';
import { HttpModule } from '@nestjs/axios';
import { RedisModule } from '@nestjs-modules/ioredis';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Payment, PartitionedEvent, SEOActivity]),
    HttpModule,
    RedisModule,
  ],
  providers: [FeatureStoreRevenueService, ExternalSEOToolsService],
  exports: [FeatureStoreRevenueService],
})
export class FeatureStoreRevenueModule {}
