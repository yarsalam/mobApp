import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { PhaseModule } from '../phase/phase.module';
import { SuggestionModule } from '../suggestion/suggestion.module';
import { UserEventModule } from '../user-event/user-event.module';
import { RedisModule } from '../redis/redis.module';
import { PaymentsModule } from '../payments/payments.module';
import { SEOModule } from '../seo/seo.module';
import { VipModule } from '../payments/vip/vip.module';
import { CreditsModule } from '../payments/credits/credits.module';
import { RelationStatusModule } from '../relation-status/relation-status.module';

// سرویس‌های جدید
import { FeedCandidateService } from './services/feed-candidate.service';
import { FeedScoringService } from './services/feed-scoring.service';
import { FeedRelationService } from './services/feed-relation.service';
import { FeedPromotionService } from './services/feed-promotion.service';
import { FeedAssemblerService } from './services/feed-assembler.service';
import { FeedController } from './feed.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PhaseModule,
    SuggestionModule,
    UserEventModule,
    RedisModule,
    PaymentsModule,
    SEOModule,
    VipModule,
    CreditsModule,
    RelationStatusModule,
  ],
  controllers: [FeedController],
  providers: [
    FeedCandidateService,
    FeedScoringService,
    FeedRelationService,
    FeedPromotionService,
    FeedAssemblerService,
  ],
  exports: [FeedAssemblerService],
})
export class FeedModule {}
