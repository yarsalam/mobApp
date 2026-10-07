import { Controller, Post, Body } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';

@Controller('dev')
export class DebugAuthController {
  constructor(private readonly redis: RedisService) {}

  // این endpoint کلید تایید تلگرام رو مستقیم در Redis ست میکنه
  // بنچمارک قبل از complete-verification این رو صدا میزنه
  @Post('set-verified')
  async setVerified(@Body() body: { phone: string }) {
    if (process.env.NODE_ENV === 'production') {
      return { error: 'Not available in production' };
    }
    await this.redis.set(`tg:verified:${body.phone}`, '1', 600);
    return { ok: true, phone: body.phone };
  }
}
