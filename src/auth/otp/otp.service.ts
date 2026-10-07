import { Injectable, BadRequestException } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import * as crypto from 'crypto';

@Injectable()
export class OtpService {
  constructor(private readonly redis: RedisService) {}

  async generate(phone: string) {
    const key = `otp:${phone}`;
    const exists = await this.redis.get(key);
    // await this.redis.del(key);
    if (exists) throw new BadRequestException('کد هنوز منقضی نشده');

    const code = crypto.randomInt(1000, 9999).toString(); // ۴ رقمی

    await this.redis.set(key, code, 180); // 3 minutes
    return code;
  }

  async verify(phone: string, code: string) {
    const key = `otp:${phone}`;
    const real = await this.redis.get(key);

    if (!real) throw new BadRequestException('کد منقضی شده');
    if (real !== code) throw new BadRequestException('کد اشتباه است');

    await this.redis.del(key);
    return true;
  }
}
