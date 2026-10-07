import { HttpService } from '@nestjs/axios';
import { Injectable, HttpException, Inject } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { createHash } from 'crypto';

const CACHE_TTL = 86400; // ۲۴ ساعت

@Injectable()
export class PersonalityAIClient {
  constructor(
    private readonly httpService: HttpService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private apiUrl(): string {
    return process.env.PERSONALITY_AI_URL || 'http://personality:8101';
  }

  private hashMessages(messages: string[]): string {
    return createHash('sha256').update(messages.join('|')).digest('hex');
  }

  async analyzeSentiment(messages: string[]): Promise<any> {
    const cacheKey = `sentiment:${this.hashMessages(messages)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
      const resp = await firstValueFrom(
        this.httpService.post(`${this.apiUrl()}/analyze_sentiment`, {
          messages,
        }),
      );
      await this.redis.set(
        cacheKey,
        JSON.stringify(resp.data.sentiments),
        'EX',
        CACHE_TTL,
      );
      return resp.data.sentiments;
    } catch {
      throw new HttpException('Personality AI unavailable', 503);
    }
  }

  async analyzeEmotion(messages: string[]): Promise<any> {
    const cacheKey = `emotion:${this.hashMessages(messages)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
      const resp = await firstValueFrom(
        this.httpService.post(`${this.apiUrl()}/analyze_emotion`, { messages }),
      );
      await this.redis.set(
        cacheKey,
        JSON.stringify(resp.data.emotions),
        'EX',
        CACHE_TTL,
      );
      return resp.data.emotions;
    } catch {
      throw new HttpException('Personality AI unavailable', 503);
    }
  }
}
