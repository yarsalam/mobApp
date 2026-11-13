import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { CampaignSEOService } from '../../../seo/services/campaign-seo.service';
import { RevenueAttributionService } from 'src/revenue/revenue-attribution.service';

@Controller('admin-api/growth/campaigns')
@UseGuards(AdminApiGuard)
export class CampaignsController {
  constructor(
    private readonly campaignSEOService: CampaignSEOService,
    private readonly revenueAttribution: RevenueAttributionService,
  ) {}

  @Get()
  async listActivities() {
    return this.campaignSEOService.getAllActivities();
  }

  @Post()
  async createActivity(@Body() dto: any) {
    return this.campaignSEOService.createActivity(dto);
  }

  @Get('analyze')
  async analyze() {
    return this.campaignSEOService.analyzeCampaigns();
  }

  @Get('ltv-by-source')
  async ltvBySource() {
    return this.revenueAttribution.calculateLTVBySource();
  }

  @Post('forecast')
  async forecast() {
    return {
      status: 'retired',
      data: null,
      reason: 'The Prophet traffic forecast does not measure qualified acquisition.',
    };
  }

  @Post('feedback')
  async sendFeedback() {
    return {
      status: 'retired',
      data: null,
      reason: 'Campaign learning now belongs to the evidence-backed acquisition report; old AI SEO feedback endpoint is retired.',
    };
  }
}
