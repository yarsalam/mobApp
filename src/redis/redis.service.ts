import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  onModuleInit() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
    });
  }

  async set(key: string, value: string, ttlSeconds = 600) {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string) {
    await this.client.del(key);
  }

  async incr(key: string) {
    return this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number) {
    return this.client.expire(key, ttlSeconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async scanKeys(pattern: string): Promise<string[]> {
    let cursor = '0';
    const found: string[] = [];

    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern);
      cursor = next;
      found.push(...keys);
    } while (cursor !== '0');

    return found;
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
