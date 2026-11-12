import { Injectable, Logger } from '@nestjs/common';
import { TechnicalSEOService } from './technical-seo.service';
import { CampaignSEOService } from './campaign-seo.service';
import { ContentOpportunityService } from './intelligence/content-opportunity.service';

@Injectable()
export class SEOCollectorService {
  private readonly logger = new Logger(SEOCollectorService.name);

  constructor(
    private readonly technicalService: TechnicalSEOService,
    private readonly campaignService: CampaignSEOService,
    private readonly contentOpportunity: ContentOpportunityService,
  ) {}

  async collectAllMetrics() {
    const [technical, campaign] = await Promise.all([
      this.technicalService.analyzeTechnicalSEO().catch((error: unknown) => {
        this.logger.warn('Technical measurement unavailable: ' + String(error));
        return null;
      }),
      this.campaignService.analyzeCampaigns().catch((error: unknown) => {
        this.logger.warn('Campaign activity ledger unavailable: ' + String(error));
        return null;
      }),
    ]);

    return {
      technical,
      campaign,
      contentOpportunities: this.contentOpportunity.generateContentIdeas(),
      acquisition: {
        status: 'available',
        endpoint: '/admin-api/seo/acquisition',
        description: 'Source cohorts, profile completion, activation, matured D7/D30 retention and currency-separated paid revenue.',
      },
      user: null,
      competitor: null,
      aeo: null,
      recommender: null,
      backlink: null,
      retiredOrUnavailable: {
        userProfileMining: 'disabled_pending_privacy_preserving_aggregation',
        competitorScraping: 'no_verified_provider',
        trafficForecasting: 'retired',
        arbitraryCompositeSeoScore: 'retired',
        backlinkChecker: 'retired_from_growth_engine',
        keywordGapAndDifficulty: 'retired_from_growth_engine',
      },
      collectedAt: new Date().toISOString(),
      partial: technical === null || !technical.dataAvailable || campaign === null,
    };
  }

  async collectFeedMetrics(_userId: number, _feedLength: number): Promise<void> {
    // Feed acquisition and activation are measured through canonical user events.
    return Promise.resolve();
  }
}
