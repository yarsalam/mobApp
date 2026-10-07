import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SocialListenerService {
  private readonly logger = new Logger(SocialListenerService.name);
  private readonly telegramToken = process.env.TELEGRAM_BOT_TOKEN;

  constructor(
    @InjectQueue('seo-analysis') private seoQueue: Queue,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async scanTelegramChannels() {
    const channels = ['hamdam_channel', 'yarsalam_channel']; // کانال‌های رقبا

    for (const channel of channels) {
      try {
        // دریافت آخرین پست‌ها با Telegram Bot API
        const url = `https://api.telegram.org/bot${this.telegramToken}/getUpdates`;
        // در عمل باید از متد getChat و getHistory استفاده کنید
        // این یک نمونه ساده با getUpdates (نیاز به ربات عضو کانال)

        // ثبت Activity
        await this.seoQueue.add('analyze-trend', {
          platform: 'telegram',
          source: channel,
          timestamp: new Date(),
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(`Telegram scan failed for ${channel}: ${message}`);
      }
    }
  }
}
