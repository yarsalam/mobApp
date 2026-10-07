import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class BrandSentimentService {
  private readonly logger = new Logger(BrandSentimentService.name);

  constructor(private readonly httpService: HttpService) {}

  async analyzeSentiment(texts: string[]): Promise<any> {
    // استفاده از سرویس ai_support برای تحلیل احساسات
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${process.env.AI_SUPPORT_URL}/analyze_sentiment`,
          {
            messages: texts,
          },
        ),
      );
      return response.data;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error('Sentiment analysis failed: ' + message);
      return { sentiment: 'neutral', score: 0.5 };
    }
  }

  async analyzeBrandMentions(brandName: string): Promise<any> {
    // جمع‌آوری متون از SocialListenerService و تحلیل آن‌ها
    // این متد می‌تواند در آینده با اتصال به Google Alerts یا Twitter API تکمیل شود
    return { mentions: 0, sentiment: 'neutral' };
  }
}
