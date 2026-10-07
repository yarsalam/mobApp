// backend/src/admin-api/controllers/growth/social.controller.ts
import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { SocialListenerService } from '../../../social-listener/social-listener.service';
import { BrandSentimentService } from '../../../seo/services/brand-sentiment.service';

@Controller('admin-api/growth/social')
@UseGuards(AdminApiGuard)
export class SocialController {
  constructor(
    private readonly socialListener: SocialListenerService,
    private readonly brandSentiment: BrandSentimentService,
  ) {}

  @Post('scan-telegram')
  async scanTelegram() {
    try {
      return await this.socialListener.scanTelegramChannels();
    } catch {
      return null;
    }
  }

  @Get('brand-sentiment')
  async getBrandSentiment(@Query('brand') brand: string) {
    try {
      return await this.brandSentiment.analyzeBrandMentions(brand);
    } catch {
      return null;
    }
  }

  @Post('analyze-texts')
  async analyzeTexts(@Body() texts: string[]) {
    try {
      return await this.brandSentiment.analyzeSentiment(texts);
    } catch {
      return null;
    }
  }
}
