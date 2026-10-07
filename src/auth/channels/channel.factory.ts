import { Injectable, BadRequestException } from '@nestjs/common';
import { IChannelSender } from './channel.interface';
import { TelegramService } from './telegram/telegram.service';

@Injectable()
export class ChannelFactory {
  constructor(private readonly telegram: TelegramService) {}

  getChannel(channel: 'telegram'): IChannelSender {
    switch (channel) {
      case 'telegram':
        return this.telegram;
      default:
        throw new BadRequestException('کانال نامعتبر است');
    }
  }
}
