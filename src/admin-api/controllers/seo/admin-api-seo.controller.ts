import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { AcquisitionGrowthService } from '../../../seo/services/acquisition-growth.service';
import { SEOCollectorService } from '../../../seo/services/seo-collector.service';
import { ContentOpportunityService } from '../../../seo/services/intelligence/content-opportunity.service';
import { CampaignSEOService } from '../../../seo/services/campaign-seo.service';
import { SEOActivity } from '../../../seo/entities/seo-activity.entity';

@Controller('admin-api/seo')
@UseGuards(AdminApiGuard)
export class AdminApiSeoController {
  constructor(
    private readonly acquisitionGrowth: AcquisitionGrowthService,
    private readonly seoCollector: SEOCollectorService,
    private readonly contentOpportunity: ContentOpportunityService,
    private readonly campaignService: CampaignSEOService,
  ) {}

  @Get('dashboard')
  async getDashboard() {
    return {
      status: 'available',
      metrics: await this.seoCollector.collectAllMetrics(),
      acquisitionEndpoint: '/admin-api/seo/acquisition',
    };
  }

  @Get('acquisition')
  async getAcquisition(@Query('days') days?: string) {
    return this.acquisitionGrowth.getReport(days === undefined ? 30 : Number(days));
  }

  // Legacy panel route retained as an alias; both paths use the same cohorts.
  @Get('funnel')
  async getFunnel(@Query('days') days?: string) {
    return this.acquisitionGrowth.getReport(days === undefined ? 30 : Number(days));
  }

  @Get('content-opportunities')
  async getContentOpportunities() {
    return this.contentOpportunity.generateContentIdeas();
  }

  @Get('admin-dashboard')
  async getAdminDashboard() {
    return {
      status: 'available',
      acquisitionEndpoint: '/admin-api/seo/acquisition',
      contentOpportunities: this.contentOpportunity.generateContentIdeas(),
      technicalAndActivityMetrics: await this.seoCollector.collectAllMetrics(),
      note: 'Traffic forecasts, keyword-retention claims, competitor estimates and composite SEO scores are retired.',
    };
  }

  @Post('activity')
  async createActivity(@Body() activity: Partial<SEOActivity>) {
    return {
      success: true,
      data: await this.campaignService.createActivity(activity),
    };
  }

  @Get('recommendations')
  async getRecommendations() {
    return {
      status: 'not_scored',
      dataAvailable: false,
      recommendations: [],
      reason: 'Arbitrary SEO scores and generic optimization recommendations are retired.',
    };
  }

  @Get('full-score')
  async getFullScore() {
    return {
      status: 'not_scored',
      score: null,
      reason: 'A composite SEO score is not a meaningful acquisition or product-quality metric.',
    };
  }

  @Get('trends-mom')
  async getTrendsMoM() {
    return {
      status: 'unavailable',
      reason: 'The legacy campaign and composite-score series is not a validated growth measure.',
    };
  }

  @Get('traffic-proxy-history')
  async getTrafficProxyHistory() {
    return {
      status: 'unavailable',
      data: null,
      reason: 'Registration counts are not website traffic or sessions.',
    };
  }

  @Get('revenue-dashboard')
  async getRevenueDashboard() {
    return {
      status: 'moved',
      endpoint: '/admin-api/revenue',
      reason: 'Revenue reporting belongs to the Revenue module, not SEO.',
    };
  }

  @Get('behavioral-keywords')
  async getBehavioralKeywords() {
    return {
      status: 'retired',
      data: [],
      reason: 'Search-keyword optimization is no longer the growth engine.',
    };
  }

  @Get('competitor-analysis')
  async getCompetitorAnalysis() {
    return {
      status: 'unavailable',
      data: null,
      reason: 'No verified competitor intelligence provider is configured.',
    };
  }

  @Get('competitor-changes')
  async getCompetitorChanges() {
    return {
      status: 'unavailable',
      data: [],
      reason: 'No verified competitor snapshots exist.',
    };
  }

  @Get('serp-features')
  async getSERPFeatures() {
    return {
      status: 'retired',
      data: [],
      reason: 'The standalone SERP feature and ranking checker is retired.',
    };
  }

  @Get('recommendations/personalized')
  async getPersonalizedRecommendations() {
    return {
      status: 'moved',
      data: [],
      reason: 'Content recommendation belongs to the product experience, not SEO acquisition.',
    };
  }

  @Get('backlink-quality')
  async getBacklinkQuality() {
    return {
      status: 'retired',
      data: null,
      reason: 'The standalone backlink-quality checker is not part of the growth engine.',
    };
  }

  @Get('google-trends')
  async getGoogleTrends() {
    return {
      status: 'retired',
      data: null,
      reason: 'Generic keyword trend tracking is not a primary Yarsalam growth capability.',
    };
  }

  @Post('keyword-gap')
  async getKeywordGap() {
    return {
      status: 'retired',
      data: null,
      reason: 'Keyword-gap and competitor-ranking checks are retired.',
    };
  }

  @Get('keywords-ranking')
  async getKeywordsRanking() {
    return {
      status: 'retired',
      data: [],
      reason: 'Keyword ranking is not a primary success metric; use acquisition cohorts.',
    };
  }
}
