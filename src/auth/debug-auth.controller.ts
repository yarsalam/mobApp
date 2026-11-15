import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { DevelopmentOnlyGuard } from 'src/common/guards/development-only.guard';
import { RedisService } from 'src/redis/redis.service';

@Controller('dev')
@UseGuards(DevelopmentOnlyGuard)
export class DebugAuthController {
  constructor(private readonly redis: RedisService) {}

  // این endpoint کلید تایید تلگرام رو مستقیم در Redis ست میکنه
  // بنچمارک قبل از complete-verification این رو صدا میزنه
  @Post('set-verified')
  async setVerified(@Body() body: { phone: string }) {
    await this.redis.set(`tg:verified:${body.phone}`, '1', 600);
    return { ok: true, phone: body.phone };
  }
}
