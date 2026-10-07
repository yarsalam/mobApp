import { Injectable } from '@nestjs/common';
import { IChannelSender } from '../channel.interface';
import { TelegramHelper } from './telegram.helper';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class TelegramService implements IChannelSender {
  constructor(
    private readonly helper: TelegramHelper,
    private readonly redis: RedisService,
  ) {}

  async saveChatId(phone: string, chatId: number) {
    await this.redis.set(`tg:chat:${phone}`, chatId.toString(), 300); // 5 min
  }

  async sendCode(phone: string, code: string) {
    const chatId = await this.redis.get(`tg:chat:${phone}`);
    if (!chatId) return false;
    return this.helper.sendTelegramMessage(chatId, code);
  }

  async isVerified(phone: string) {
    const result = !!(await this.redis.get(`tg:verified:${phone}`));
    return !!result;
  }
}
