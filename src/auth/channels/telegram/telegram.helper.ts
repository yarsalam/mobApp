import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class TelegramHelper {
  private readonly logger = new Logger(TelegramHelper.name);
  private readonly botToken = process.env.TELEGRAM_BOT_TOKEN;

  async sendTelegramMessage(
    chatId: number | string,
    code: string,
  ): Promise<boolean> {
    try {
      await axios.post(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        { chat_id: chatId, text: `کد تایید شما: ${code}` },
      );
      return true;
    } catch (err: unknown) {
      const detail = axios.isAxiosError(err)
        ? JSON.stringify(err.response?.data ?? err.message)
        : err instanceof Error
          ? err.message
          : String(err);
      this.logger.error(`Telegram send failed for chatId ${chatId}: ${detail}`);
      return false;
    }
  }
}
