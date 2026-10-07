import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SEORecommendation } from '../../entities/seo-recommendation.entity';

@Injectable()
export class AutoExecutorService {
  private readonly logger = new Logger(AutoExecutorService.name);
  constructor(private readonly httpService: HttpService) {}

  async executeRecommendation(rec: SEORecommendation) {
    // بسته به نوع توصیه، عمل مناسب را انجام دهید
    this.logger.log(`Executing recommendation: ${rec.title}`);

    // مثال: اگر توصیه به بهبود meta description است
    if (rec.title.includes('meta description')) {
      const cmsUrl = process.env.CMS_API_URL + '/update-meta';
      try {
        await firstValueFrom(
          this.httpService.post(cmsUrl, {
            page: rec.metrics?.page,
            description: rec.metrics?.newDescription,
          }),
        );
        this.logger.log(`Meta description updated for ${rec.metrics?.page}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to execute: ${msg}`);
      }
    }

    // مثال: انتشار محتوای جدید در CMS
    if (rec.title.includes('content publish')) {
      const cmsUrl = process.env.CMS_API_URL + '/publish';
      await firstValueFrom(this.httpService.post(cmsUrl, rec.metrics?.content));
    }

    // پس از اجرا، وضعیت توصیه را در دیتابیس به‌روز کنید
    // (این بخش باید توسط سرویسی که توصیه‌ها را مدیریت می‌کند انجام شود)
  }
}
