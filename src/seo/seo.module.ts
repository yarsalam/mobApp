import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';

// Entities
import { SEOMetrics } from './entities/seo-metrics.entity';
import { SEOActivity } from './entities/seo-activity.entity';
import { SEORecommendation } from './entities/seo-recommendation.entity';
import { CompetitorData } from './entities/competitor-data.entity';

// Services
import { TechnicalSEOService } from './services/technical-seo.service';
import { UserSEOSignalsService } from './services/user-seo-signals.service';
import { CampaignSEOService } from './services/campaign-seo.service';
import { CompetitorSEOService } from './services/competitor-seo.service';
import { SEOScoreEngine } from './services/seo-score-engine.service';
import { SEOCollectorService } from './services/seo-collector.service';

// Modules
import { UserEventModule } from '../user-event/user-event.module';
import { UserMetricsModule } from '../user-metrics/user-metrics.module';
import { ExternalSEOToolsService } from './services/external-seo-tools.service';
import { SEOController } from './seo.controller';
import { InteractionsModule } from 'src/interaction/interaction.module';
import { FeatureStoreRevenueModule } from 'src/feature-store-rvenue/feature-store-rvenue.module';
import { SEORetentionService } from './services/analytics/seo-retention.service';
import { SEOService } from './services/seo.service';
import { User } from 'src/users/entities/user.entity';
import { ContentOpportunityService } from './services/intelligence/content-opportunity.service';
import { Interaction } from 'src/interaction/entities/interaction.entity';
import { Payment } from 'src/payments/entities/payment.entity';
import { AutoScalingService } from './services/intelligence/auto-scaling.service';
import { SocialListenerService } from 'src/social-listener/social-listener.service';
import { SocialListenerModule } from 'src/social-listener/social-listener.module';
import { SERPFeatureHunterService } from './services/serp-feature-hunter.service';
import { BrandSentimentService } from './services/brand-sentiment.service';
import { FeatureStoreModule } from 'src/feature-store/feature-store.module';
import { AutoExecutorService } from './services/intelligence/auto-executor.service';
import { RevenueModule } from 'src/revenue/revenue.module';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { SeoRecommenderService } from './services/seo-recommender.service';
import { BacklinkQualityService } from './services/backlink-quality.service';
import { CampaignUpliftService } from './services/campaign-uplift.service';
import { AEOTrackerService } from './services/intelligence/aeo-tracker.service';
import { getExternalHttpOptions } from 'src/config/http-client.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SEOMetrics,
      SEOActivity,
      SEORecommendation,
      CompetitorData,
      PartitionedEvent,
      User,
      Interaction,
      Payment,
    ]),
    HttpModule.register(getExternalHttpOptions()),
    BullModule.registerQueue({
      name: 'seo-analysis',
    }),
    UserEventModule,
    UserMetricsModule,
    InteractionsModule,
    FeatureStoreRevenueModule,
    SocialListenerModule,
    FeatureStoreModule,
    RevenueModule,
  ],
  controllers: [SEOController],
  providers: [
    TechnicalSEOService,
    UserSEOSignalsService,
    CampaignSEOService,
    CompetitorSEOService,
    SEOScoreEngine,
    SEOCollectorService,
    ExternalSEOToolsService,
    SEORetentionService,
    SEOService,
    ContentOpportunityService,
    AutoScalingService,
    SocialListenerService,
    SERPFeatureHunterService,
    BrandSentimentService,
    AutoExecutorService,
    SeoRecommenderService,
    BacklinkQualityService,
    CampaignUpliftService,
    AEOTrackerService,
  ],
  exports: [
    SEOScoreEngine,
    SEOCollectorService,
    ExternalSEOToolsService,
    SocialListenerService,
    SEOService,
    SEORetentionService,
    ContentOpportunityService,
    SeoRecommenderService,
    BacklinkQualityService,
    CampaignUpliftService,
    AEOTrackerService,
    CampaignSEOService,
  ],
})
export class SEOModule {}
