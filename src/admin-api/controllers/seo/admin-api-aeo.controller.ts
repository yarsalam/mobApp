import { Controller, Post, Body, UseGuards, Get, Query } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { AEOTrackerService } from '../../../seo/services/intelligence/aeo-tracker.service';
import { SeoRecommenderService } from 'src/seo/services/seo-recommender.service';
import { BacklinkQualityService } from 'src/seo/services/backlink-quality.service';
import { SEOScoreEngine } from 'src/seo/services/seo-score-engine.service';
import { SEOCollectorService } from 'src/seo/services/seo-collector.service';

@Controller('admin-api/seo/aeo')
@UseGuards(AdminApiGuard)
export class AdminApiAeoController {
  constructor(
    private readonly aeoTracker: AEOTrackerService,
    private readonly recommenderService: SeoRecommenderService,
    private readonly backlinkQualityService: BacklinkQualityService,
    private readonly seoScoreEngine: SEOScoreEngine,
    private readonly seoCollectorService: SEOCollectorService,
  ) {}

  /**
   * بررسی این‌که آیا برند در پاسخ‌های موتورهای پاسخ‌گوی هوش مصنوعی (ChatGPT و مشابه)
   * ذکر می‌شود یا نه — Answer Engine Optimization. برای هر prompt، پاسخ مدل بررسی
   * می‌شود که آیا نام برند در آن آمده و با چه sentiment ای.
   *
   * مثال prompts:
   *   "بهترین اپ همسریابی ایران چیست؟"
   *   "{brand} چطور اپیه؟"
   */
  @Post('check-mentions')
  async checkMentions(@Body() body: { brand: string; prompts: string[] }) {
    try {
      const result = await this.aeoTracker.getMentions(
        body.brand,
        body.prompts,
      );
      return { success: true, data: result };
    } catch {
      return { success: false, data: null };
    }
  }
  // backend/src/admin-api/controllers/seo/admin-api-seo.controller.ts

  @Get('recommendations')
  async getRecommendations(@Query('userId') userId: string) {
    const result = await this.recommenderService.recommend(userId, 5);
    return { success: true, data: result };
  }

  @Get('backlink-quality')
  async getBacklinkQuality(@Query('domain') domain: string) {
    // فرض: یک متد ساده‌تر برای گرفتن امتیاز یک دامنه، از health/cache موجود
    const health = await this.backlinkQualityService.health();
    return { success: true, data: health };
  }

  @Get('full-score')
  async getFullScore() {
    const metrics = await this.seoCollectorService.collectAllMetrics();
    const score = this.seoScoreEngine.calculateOverallScore(metrics);
    return { success: true, data: { metrics, score } };
  }
}
