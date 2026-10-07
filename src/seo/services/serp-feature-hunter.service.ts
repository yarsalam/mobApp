import { Injectable, Logger } from '@nestjs/common';
import { ExternalSEOToolsService } from './external-seo-tools.service';

@Injectable()
export class SERPFeatureHunterService {
  private readonly logger = new Logger(SERPFeatureHunterService.name);

  constructor(private readonly externalTools: ExternalSEOToolsService) {}

  async huntFeatures(keyword: string): Promise<any> {
    const serpData = await this.externalTools.getLiveSerpRanking(keyword, '');

    // تحلیل ساختار SERP (در نسخه واقعی باید از SerpAPI استفاده کنید که خروجی کامل دارد)
    const features = {
      featuredSnippet: serpData?.featured_snippet || false,
      peopleAlsoAsk: serpData?.people_also_ask || [],
      videoCarousel: serpData?.video_carousel || false,
    };

    // پیشنهاد محتوا بر اساس ویژگی‌ها
    if (!features.featuredSnippet) {
      return {
        opportunity: 'تصاحب Featured Snippet',
        recommendation: `ایجاد محتوای جامع و ساختاریافته برای "${keyword}" که بتواند جایگاه صفر را تصاحب کند.`,
      };
    }

    return {
      message:
        'در حال حاضر Featured Snippet وجود دارد، می‌توانید آن را بهینه کنید.',
    };
  }
}
