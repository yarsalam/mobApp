import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { ContentOpportunityService } from '../../../seo/services/intelligence/content-opportunity.service';
import { SEOCollectorService } from '../../../seo/services/seo-collector.service';
import { AcquisitionGrowthService } from '../../../seo/services/acquisition-growth.service';

@Controller('admin-api/growth/seo-studio')
@UseGuards(AdminApiGuard)
export class SeoStudioController {
  constructor(
    private readonly contentOpportunity: ContentOpportunityService,
    private readonly seoCollector: SEOCollectorService,
    private readonly acquisitionGrowth: AcquisitionGrowthService,
  ) {}

  @Get('content-ideas')
  async getContentIdeas() {
    return this.contentOpportunity.generateContentIdeas();
  }

  @Get('high-intent-content')
  async getHighIntentContent() {
    return this.contentOpportunity.generateHighIntentContent();
  }

  @Get('acquisition')
  async getAcquisition(@Query('days') days?: string) {
    return this.acquisitionGrowth.getReport(days === undefined ? 30 : Number(days));
  }

  @Get('health-summary')
  async getHealthSummary() {
    const metrics = await this.seoCollector.collectAllMetrics();
    return {
      status: metrics.partial ? 'partial' : 'available',
      dataAvailable: !metrics.partial,
      technical: metrics.technical,
      retiredFeatures: metrics.retiredOrUnavailable,
      acquisitionEndpoint: '/admin-api/seo/acquisition',
      compositeSeoScore: null,
    };
  }

  @Get('keyword-rankings')
  async getKeywordRankings() {
    return { status: 'retired', data: [], reason: 'Use source-based acquisition outcomes rather than keyword rankings.' };
  }

  @Get('serp-features')
  async getSERPFeatures() {
    return { status: 'retired', data: [], reason: 'Standalone SERP feature tracking is not part of the growth engine.' };
  }

  @Get('competitor-analysis')
  async getCompetitorAnalysis() {
    return { status: 'unavailable', data: null, reason: 'No verified competitor provider is configured.' };
  }

  @Get('competitor-changes')
  async getCompetitorChanges() {
    return { status: 'unavailable', data: [], reason: 'No verified competitor snapshots exist.' };
  }

  @Get('ai-recommendations')
  async getAIRecommendations() {
    return { status: 'retired', data: [], reason: 'Static ROI and campaign recommendations are retired.' };
  }

  @Get('google-trends')
  async getGoogleTrends() {
    return { status: 'retired', data: null, reason: 'Keyword trend tools are not a primary growth metric.' };
  }

  @Get('keyword-gap')
  async getKeywordGap() {
    return { status: 'retired', data: null, reason: 'Keyword-gap analysis is retired from the growth engine.' };
  }
}
