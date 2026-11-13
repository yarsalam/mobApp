import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';

// Entities
import { SEOMetrics } from './entities/seo-metrics.entity';
import { SEOActivity } from './entities/seo-activity.entity';

// Services
import { TechnicalSEOService } from './services/technical-seo.service';
import { AcquisitionGrowthService } from './services/acquisition-growth.service';
import { CampaignSEOService } from './services/campaign-seo.service';
import { SEOCollectorService } from './services/seo-collector.service';

// Modules
import { UserEventModule } from '../user-event/user-event.module';
import { ExternalSEOToolsService } from './services/external-seo-tools.service';
import { SEOController } from './seo.controller';
import { User } from 'src/users/entities/user.entity';
import { ContentOpportunityService } from './services/intelligence/content-opportunity.service';
import { Payment } from 'src/payments/entities/payment.entity';
import { SocialListenerModule } from 'src/social-listener/social-listener.module';
import { BrandSentimentService } from './services/brand-sentiment.service';
import { RevenueModule } from 'src/revenue/revenue.module';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { CampaignUpliftService } from './services/campaign-uplift.service';
import { AEOTrackerService } from './services/intelligence/aeo-tracker.service';
import { getExternalHttpOptions } from 'src/config/http-client.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SEOMetrics,
      SEOActivity,
      PartitionedEvent,
      User,
      Payment,
    ]),
    HttpModule.register(getExternalHttpOptions()),
    UserEventModule,
    SocialListenerModule,
    RevenueModule,
  ],
  controllers: [SEOController],
  providers: [
    TechnicalSEOService,
    AcquisitionGrowthService,
    CampaignSEOService,
    SEOCollectorService,
    ExternalSEOToolsService,
    ContentOpportunityService,
    BrandSentimentService,
    CampaignUpliftService,
    AEOTrackerService,
  ],
  exports: [
    SEOCollectorService,
    ExternalSEOToolsService,
    ContentOpportunityService,
    CampaignUpliftService,
    AEOTrackerService,
    CampaignSEOService,
    AcquisitionGrowthService,
  ],
})
export class SEOModule {}
