// backend/src/admin-api/controllers/growth/campaigns.controller.ts
import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { CampaignSEOService } from '../../../seo/services/campaign-seo.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { RevenueAttributionService } from 'src/revenue/revenue-attribution.service';

@Controller('admin-api/growth/campaigns')
@UseGuards(AdminApiGuard)
export class CampaignsController {
  private aiSeoUrl: string;
  constructor(
    private readonly campaignSEOService: CampaignSEOService,
    private readonly revenueAttribution: RevenueAttributionService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.aiSeoUrl = this.config.get('AI_SEO_URL') || 'http://ai_seo:8021';
  }

  @Get()
  async listActivities() {
    try {
      return await this.campaignSEOService.getAllActivities();
    } catch {
      return []; // fallback mock
    }
  }

  @Post()
  async createActivity(@Body() dto: any) {
    return this.campaignSEOService.createActivity(dto);
  }

  @Get('analyze')
  async analyze() {
    try {
      return await this.campaignSEOService.analyzeCampaigns();
    } catch {
      return null;
    }
  }

  @Get('ltv-by-source')
  async ltvBySource() {
    try {
      return await this.revenueAttribution.calculateLTVBySource();
    } catch {
      return [];
    }
  }

  @Post('forecast')
  async forecast(@Body() body: { historicalData: any[]; days?: number }) {
    try {
      const { data } = await firstValueFrom(
        this.http.post(`${this.aiSeoUrl}/predict/traffic`, {
          historical_data: body.historicalData,
          days: body.days || 90,
        }),
      );
      return data;
    } catch {
      return null;
    }
  }

  @Post('feedback')
  async sendFeedback(@Body() body: any) {
    try {
      const { data } = await firstValueFrom(
        this.http.post(`${this.aiSeoUrl}/feedback/campaign`, {
          campaigns: body,
        }),
      );
      return data;
    } catch {
      return null;
    }
  }
}
