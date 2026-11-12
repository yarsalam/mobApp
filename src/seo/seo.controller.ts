import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { SEOActivity } from './entities/seo-activity.entity';
import { CampaignSEOService } from './services/campaign-seo.service';
import { SEOCollectorService } from './services/seo-collector.service';
import { SEORetentionService } from './services/analytics/seo-retention.service';
import { SEOService } from './services/seo.service';
import { ContentOpportunityService } from './services/intelligence/content-opportunity.service';
import { RevenueIntelligenceService } from 'src/revenue/revenue-intelligence.service';
import { AutoScalingService } from './services/intelligence/auto-scaling.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SEORecommendation } from './entities/seo-recommendation.entity';
import { AutoExecutorService } from './services/intelligence/auto-executor.service';
import { RevenueAttributionService } from 'src/revenue/revenue-attribution.service';
import { SEOScoreEngine } from './services/seo-score-engine.service';

@ApiTags('seo')
@Controller('seo')
@UseGuards(JwtAuthGuard)
export class SEOController {
  constructor(
    @InjectRepository(SEORecommendation)
    private seoRecommendationRepo: Repository<SEORecommendation>,

    private readonly seoCollector: SEOCollectorService,
    private readonly campaignService: CampaignSEOService,
    private readonly seoRetentionService: SEORetentionService,
    private readonly seoService: SEOService,
    private readonly contentOpportunity: ContentOpportunityService,
    private readonly revenueIntelligence: RevenueIntelligenceService,
    private readonly revenueAttribution: RevenueAttributionService,
    private readonly autoScaling: AutoScalingService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly autoExecutor: AutoExecutorService,
    private readonly seoScoreEngine: SEOScoreEngine,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'دریافت داشبورد سئو' })
  async getDashboard() {
    const metrics = await this.seoCollector.collectAllMetrics();
    return {
      success: true,
      data: metrics,
    };
  }

  @Get('revenue-dashboard')
  async getRevenueDashboard() {
    return {
      status: 'moved',
      endpoint: '/admin-api/revenue',
      reason: 'Revenue analytics is not an SEO score or traffic forecast.',
    };
  }

  @Post('activity')
  @ApiOperation({ summary: 'ثبت فعالیت سئو' })
  async createActivity(@Body() activity: Partial<SEOActivity>) {
    const result = await this.campaignService.createActivity(activity);
    return {
      success: true,
      data: result,
    };
  }

  @Get('recommendations')
  async getRecommendations() {
    return {
      status: 'not_scored',
      recommendations: [],
      reason: 'Generic SEO scoring and keyword-based optimization recommendations are retired.',
    };
  }

  @Get('admin/dashboard')
  async getAdminDashboard() {
    return {
      status: 'moved',
      endpoint: '/admin-api/seo/admin-dashboard',
      reason: 'The legacy dashboard contained synthetic audience insights and unsupported ROI/retention claims.',
    };
  }

  @Post('execute-recommendation/:id')
  async executeRecommendation() {
    return {
      status: 'disabled',
      reason: 'Automatic publication and unreviewed SEO recommendation execution are disabled.',
    };
  }


}
