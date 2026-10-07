import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SEOActivity } from '../entities/seo-activity.entity';

export interface UpliftTrainResult {
  status: string;
  samples: number;
  avg_uplift: number;
}

@Injectable()
export class CampaignUpliftService {
  private readonly logger = new Logger(CampaignUpliftService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRepository(SEOActivity)
    private readonly activityRepo: Repository<SEOActivity>,
  ) {
    this.baseUrl =
      this.configService.get('AI_UPLIFT_URL') || 'http://ai_uplift:8031';
  }

  /**
   * آموزش مدل uplift از روی فعالیت‌های سئوی گذشته.
   * treatment=1 یعنی کمپین اجرا شده (cost > 0)، treatment=0 یعنی فعالیت ارگانیک بوده.
   * outcome = revenue واقعی فعالیت.
   * این مدل تفاوت واقعی (incremental) بین اجرای کمپین و عدم اجرا را یاد می‌گیرد —
   * نه فقط همبستگی ساده‌ی هزینه/درآمد.
   */
  async trainFromActivities(days = 90): Promise<UpliftTrainResult | null> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const activities = await this.activityRepo
      .createQueryBuilder('a')
      .where('a.performedAt >= :since', { since })
      .getMany();

    if (activities.length < 20) {
      this.logger.warn(
        `Not enough activities for uplift training: ${activities.length} < 20`,
      );
      return null;
    }

    const data = activities.map((a) => ({
      treatment: a.cost > 0 ? 1 : 0,
      revenue: a.results?.revenue ?? 0,
      cost: Number(a.cost) || 0,
      platform_encoded: this.encodePlatform(a.platform),
      content_length: a.content?.length ?? 0,
    }));

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/train`,
          {
            data,
            treatment_col: 'treatment',
            outcome_col: 'revenue',
            features: ['cost', 'platform_encoded', 'content_length'],
          },
          { timeout: 30000 },
        ),
      );
      this.logger.log(
        `Uplift model trained: ${response.data?.samples} samples, avg_uplift=${response.data?.avg_uplift}`,
      );
      return response.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Uplift training failed: ${message}`);
      return null;
    }
  }

  /**
   * پیش‌بینی تأثیر واقعی (incremental) یک کمپین پیشنهادی — یعنی چقدر از درآمد
   * واقعاً به‌خاطر خرج کردن روی این کمپین اضافه می‌شود، نه صرفاً همبستگی.
   */
  async predictUplift(
    features: { cost: number; platform: string; contentLength: number }[],
  ): Promise<number[] | null> {
    if (!features.length) return null;

    const encoded = features.map((f) => [
      f.cost,
      this.encodePlatform(f.platform),
      f.contentLength,
    ]);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/predict-uplift`,
          { features: encoded },
          { timeout: 10000 },
        ),
      );
      return response.data?.uplift ?? null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Uplift prediction failed: ${message}`);
      return null;
    }
  }

  /**
   * مقایسه‌ی uplift پیش‌بینی‌شده برای چند پلتفرم با یک بودجه‌ی فرضی ثابت،
   * تا مشخص شود کدام پلتفرم incremental value واقعی بیشتری می‌دهد.
   */
  async compareUpliftByPlatform(
    hypotheticalBudget: number,
    platforms: string[],
  ): Promise<{ platform: string; predictedUplift: number }[] | null> {
    const avgContentLength = 500; // پیش‌فرض معقول برای مقایسه‌ی نسبی
    const features = platforms.map((platform) => ({
      cost: hypotheticalBudget,
      platform,
      contentLength: avgContentLength,
    }));

    const uplifts = await this.predictUplift(features);
    if (!uplifts) return null;

    return platforms.map((platform, i) => ({
      platform,
      predictedUplift: uplifts[i],
    }));
  }

  private encodePlatform(platform: string): number {
    const map: Record<string, number> = {
      instagram: 1,
      telegram: 2,
      linkedin: 3,
      medium: 4,
      quora: 5,
      google_ads: 6,
      other: 0,
    };
    return map[platform] ?? 0;
  }

  async health(): Promise<{ status: string; model_trained: boolean } | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/health`, { timeout: 3000 }),
      );
      return response.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Uplift health check failed: ${message}`);
      return null;
    }
  }
}
