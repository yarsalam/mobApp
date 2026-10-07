import { Module, Global } from '@nestjs/common';
import { Redis } from 'ioredis';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.constants';
import { BoostQueueService } from './boost-queue.service';

@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        return new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          retryStrategy: (times) => Math.min(times * 50, 2000),
          maxRetriesPerRequest: 3,
        });
      },
    },
    // BoostQueueService را اینجا provide می‌کنیم چون Global است
    {
      provide: BoostQueueService,
      useFactory: (redis: Redis) => new BoostQueueService(redis),
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [RedisService, REDIS_CLIENT, BoostQueueService],
})
export class RedisModule {}
