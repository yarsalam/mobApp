import { forwardRef, Module } from '@nestjs/common';
import { ChannelFactory } from './channel.factory';
import { TelegramService } from './telegram/telegram.service';
import { TelegramHelper } from './telegram/telegram.helper';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  providers: [ChannelFactory, TelegramService, TelegramHelper],
  exports: [ChannelFactory],
  imports: [WhatsappModule, RedisModule],
})
export class ChannelsModule {}
