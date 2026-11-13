import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { SEOActivity } from './entities/seo-activity.entity';
import { CampaignSEOService } from './services/campaign-seo.service';
import { SEOCollectorService } from './services/seo-collector.service';

@ApiTags('seo')
@Controller('seo')
@UseGuards(JwtAuthGuard)
export class SEOController {
  constructor(
    private readonly seoCollector: SEOCollectorService,
    private readonly campaignService: CampaignSEOService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'دریافت وضعیت فنی و فعالیت‌های ثبت‌شده رشد' })
  async getDashboard() {
    return { success: true, data: await this.seoCollector.collectAllMetrics() };
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
  @ApiOperation({ summary: 'ثبت فعالیت واقعی کمپین؛ بدون برآورد ROI' })
  async createActivity(@Body() activity: Partial<SEOActivity>) {
    return { success: true, data: await this.campaignService.createActivity(activity) };
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
      reason: 'Use source-based acquisition cohorts and evidence-backed technical measurements.',
    };
  }

  @Post('execute-recommendation/:id')
  async executeRecommendation() {
    return {
      status: 'disabled',
      reason: 'Automatic publishing and unreviewed recommendation execution are disabled.',
    };
  }
}
