import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { TelegramHelper } from './telegram.helper';
import { OtpModule } from 'src/auth/otp/otp.module';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [OtpModule, RedisModule],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramHelper], // ← اضافه کردن TelegramHelper
  exports: [TelegramService], // اگر میخوای از ماژول‌های دیگه هم استفاده بشه
})
export class TelegramModule {}
