import { Controller, Post, Body, UseGuards, Get, Query } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { AEOTrackerService } from '../../../seo/services/intelligence/aeo-tracker.service';

@Controller('admin-api/seo/aeo')
@UseGuards(AdminApiGuard)
export class AdminApiAeoController {
  constructor(private readonly aeoTracker: AEOTrackerService) {}

  @Post('check-mentions')
  async checkMentions(@Body() body: { brand: string; prompts: string[] }) {
    try {
      const result = await this.aeoTracker.getMentions(body.brand, body.prompts);
      return { success: true, data: result };
    } catch {
      return {
        success: false,
        data: null,
        reason: 'answer_engine_provider_unavailable',
      };
    }
  }

  @Get('recommendations')
  async getRecommendations(@Query('userId') _userId: string) {
    return {
      status: 'moved',
      data: [],
      reason: 'Product recommendations belong to the Matching/Product experience, not SEO.',
    };
  }

  @Get('backlink-quality')
  async getBacklinkQuality(@Query('domain') _domain: string) {
    return {
      status: 'retired',
      data: null,
      reason: 'Backlink checker metrics are not part of Yarsalam growth intelligence.',
    };
  }

  @Get('full-score')
  async getFullScore() {
    return {
      status: 'not_scored',
      score: null,
      reason: 'A composite SEO score is retired; acquisition outcomes and technical evidence are reported separately.',
    };
  }
}
