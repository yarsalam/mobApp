import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip = req.ip;
    const key = `ratelimit:${ip}`;
    const count = await this.redis.incr(key);

    if (count === 1) await this.redis.expire(key, 60); // ۱ دقیقه

    if (count > 5) {
      throw new HttpException(
        'درخواست بیش از حد مجاز است',
        HttpStatus.TOO_MANY_REQUESTS, // 🔢 معادل 429
      );
    }

    return true;
  }
}
