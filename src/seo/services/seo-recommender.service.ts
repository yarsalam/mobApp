import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface RecommendTrainInteraction {
  userId: string;
  itemId: string;
  rating: number;
}

export interface RecommendResult {
  user_id: string;
  recommendations: string[];
}

@Injectable()
export class SeoRecommenderService {
  private readonly logger = new Logger(SeoRecommenderService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl =
      this.configService.get('AI_SEO_RECOMMENDER_URL') ||
      'http://ai_seo_recommender:8033';
  }

  /**
   * شروع آموزش مدل CF به‌صورت background در سرویس Python.
   * تعداد تعاملات کم (< چند صد) معمولاً برای train بی‌فایده است؛
   * تصمیم نهایی درباره حداقل نمونه در خود سرویس Python گرفته می‌شود.
   */
  async train(interactions: RecommendTrainInteraction[]): Promise<{
    status: string;
    interactions: number;
  } | null> {
    if (!interactions.length) {
      this.logger.warn('train() called with empty interactions, skipping');
      return null;
    }

    try {
      const payload = {
        interactions: interactions.map((i) => [i.userId, i.itemId, i.rating]),
      };
      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/train`, payload, {
          timeout: 10000,
        }),
      );
      this.logger.log(
        `CF training started: ${response.data?.interactions ?? 0} interactions`,
      );
      return response.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`CF training request failed: ${message}`);
      return null;
    }
  }

  /**
   * دریافت پیشنهادهای مبتنی بر Collaborative Filtering برای یک کاربر.
   * برای کاربر ناشناخته (cold start)، سرویس Python خودش محبوب‌ترین‌ها را برمی‌گرداند.
   */
  async recommend(userId: string, n = 5): Promise<RecommendResult | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/recommend`,
          { user_id: userId, n },
          { timeout: 5000 },
        ),
      );
      return response.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`CF recommend failed for user ${userId}: ${message}`);
      return null;
    }
  }

  async health(): Promise<{
    status: string;
    model_trained: boolean;
    popular_items_count: number;
  } | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/health`, { timeout: 3000 }),
      );
      return response.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`CF health check failed: ${message}`);
      return null;
    }
  }
}
