import { Injectable, Logger } from '@nestjs/common';
import { TechnicalSEOService } from './technical-seo.service';
import { UserSEOSignalsService } from './user-seo-signals.service';
import { CampaignSEOService } from './campaign-seo.service';
import { CompetitorSEOService } from './competitor-seo.service';
import { SEOScoreEngine } from './seo-score-engine.service';
import { AEOTrackerService } from './intelligence/aeo-tracker.service';
import { SeoRecommenderService } from './seo-recommender.service';
import { BacklinkQualityService } from './backlink-quality.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SEOCollectorService {
  private readonly logger = new Logger(SEOCollectorService.name);

  constructor(
    private readonly technicalService: TechnicalSEOService,
    private readonly userService: UserSEOSignalsService,
    private readonly campaignService: CampaignSEOService,
    private readonly competitorService: CompetitorSEOService,
    private readonly scoreEngine: SEOScoreEngine,
    private readonly aeoTracker: AEOTrackerService,
    private readonly recommenderService: SeoRecommenderService,
    private readonly backlinkQualityService: BacklinkQualityService,
    private readonly configService: ConfigService,
  ) {}

  async collectAllMetrics() {
    const [technical, user, campaign, competitor, aeo, recommender, backlink] =
      await Promise.all([
        this.collectSafely('technical', () =>
          this.technicalService.analyzeTechnicalSEO(),
        ),
        this.collectSafely('user', () => this.userService.analyzeUserSignals()),
        this.collectSafely('campaign', () =>
          this.campaignService.analyzeCampaigns(),
        ),
        this.collectSafely('competitor', () =>
          this.competitorService.analyzeCompetitors(),
        ),
        this.collectSafely('aeo', () => this.collectAEOMetrics()),
        this.collectSafely('recommender', () =>
          this.collectRecommenderMetrics(),
        ),
        this.collectSafely('backlink', () => this.collectBacklinkMetrics()),
      ]);

    return {
      technical,
      user,
      campaign,
      competitor,
      aeo,
      recommender,
      backlink,
      collectedAt: new Date().toISOString(),
      partial:
        technical === null ||
        user === null ||
        campaign === null ||
        competitor === null ||
        aeo === null ||
        recommender === null ||
        backlink === null,
    };
  }

  private async collectAEOMetrics() {
    try {
      const result = await this.aeoTracker.getMentions(
        this.configService.get('BRAND_NAME') || 'YourBrand',
        ['بهترین اپ همسریابی ایران چیست؟', 'اپ‌های دوستیابی معتبر کدامند؟'],
      );
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AEO metrics collection failed: ${message}`);
      return null;
    }
  }

  private async collectRecommenderMetrics() {
    try {
      return await this.recommenderService.health();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Recommender metrics collection failed: ${message}`);
      return null;
    }
  }

  private async collectBacklinkMetrics() {
    try {
      return await this.backlinkQualityService.health();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Backlink metrics collection failed: ${message}`);
      return null;
    }
  }

  async collectFeedMetrics(userId: number, feedLength: number) {
    // لاگ برای تحلیل سئو
    this.logger.debug(`Feed metrics for user ${userId}: ${feedLength} items`);
    // TODO: ذخیره در دیتابیس
    return Promise.resolve();
  }

  private async collectSafely<T>(
    name: string,
    task: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await task();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`SEO collection failed [${name}]: ${message}`);

      return null;
    }
  }
}
