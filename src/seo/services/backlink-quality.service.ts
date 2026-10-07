import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { REDIS_CLIENT } from 'src/redis/redis.constants';
import { Redis } from 'ioredis';

export interface TrustFlowResult {
  [domain: string]: number;
}

const TRUST_FLOW_CACHE_TTL = 86400; // 24h — گراف بک‌لینک به‌ندرت تغییر می‌کند
const TOPIC_SIMILARITY_CACHE_TTL = 604800; // 7d — متن منبع/هدف معمولاً ثابت است

@Injectable()
export class BacklinkQualityService {
  private readonly logger = new Logger(BacklinkQualityService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.baseUrl =
      this.configService.get('AI_BACKLINK_QUALITY_URL') ||
      'http://ai_backlink_quality:8032';
  }

  /**
   * محاسبه TrustRank/TrustFlow برای مجموعه‌ای از دامنه‌ها بر اساس گراف بک‌لینک.
   * edges: آرایه‌ای از [source_domain, target_domain]
   * trustedSeeds: دامنه‌های معتبر (مثلاً .gov, .edu) برای بایاس PageRank
   */
  async calculateTrustFlow(
    edges: [string, string][],
    trustedSeeds: string[] = [],
  ): Promise<TrustFlowResult | null> {
    if (!edges.length) {
      this.logger.warn('calculateTrustFlow called with empty edges');
      return null;
    }

    const cacheKey = `backlink:trust-flow:${this.hashEdges(edges, trustedSeeds)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/trust-flow`,
          { edges, trusted_seeds: trustedSeeds },
          { timeout: 15000 },
        ),
      );
      await this.redis.set(
        cacheKey,
        JSON.stringify(response.data),
        'EX',
        TRUST_FLOW_CACHE_TTL,
      );
      return response.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Trust flow calculation failed: ${message}`);
      return null;
    }
  }

  /**
   * شباهت موضوعی دو متن (مثلاً صفحه‌ی منبع بک‌لینک و صفحه‌ی هدف) از طریق embedding.
   * برای تعیین این‌که آیا یک بک‌لینک از نظر موضوعی مرتبط است یا نه (مهم برای کیفیت بک‌لینک).
   */
  async getTopicSimilarity(
    sourceText: string,
    targetText: string,
  ): Promise<number> {
    if (!sourceText?.trim() || !targetText?.trim()) return 0;

    const cacheKey = `backlink:topic-sim:${this.hashText(sourceText)}:${this.hashText(targetText)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return parseFloat(cached);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/topic-similarity`,
          { source_text: sourceText, target_text: targetText },
          { timeout: 10000 },
        ),
      );
      const similarity = response.data?.similarity ?? 0;
      await this.redis.set(
        cacheKey,
        similarity.toString(),
        'EX',
        TOPIC_SIMILARITY_CACHE_TTL,
      );
      return similarity;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Topic similarity failed: ${message}`);
      return 0;
    }
  }

  /**
   * امتیاز ترکیبی کیفیت یک بک‌لینک بالقوه: ترکیب TrustFlow دامنه‌ی منبع + شباهت موضوعی.
   * برای استفاده در CompetitorSEOService هنگام ارزیابی فرصت‌های بک‌لینک.
   */
  async scoreBacklinkOpportunity(
    sourceDomain: string,
    sourceText: string,
    ourText: string,
    knownEdges: [string, string][],
    trustedSeeds: string[],
  ): Promise<{ trustScore: number; topicRelevance: number; combined: number }> {
    const [trustFlow, topicRelevance] = await Promise.all([
      this.calculateTrustFlow(knownEdges, trustedSeeds),
      this.getTopicSimilarity(sourceText, ourText),
    ]);

    const trustScore = trustFlow?.[sourceDomain] ?? 0;
    // وزن‌دهی: trust بیشتر اهمیت دارد اما relevance موضوعی هم مهم است
    const combined = trustScore * 0.6 + topicRelevance * 0.4;

    return {
      trustScore,
      topicRelevance,
      combined: Math.round(combined * 1000) / 1000,
    };
  }

  private hashText(text: string): string {
    // هش ساده برای کلید کش — کافی است چون فقط برای dedup است، نه امنیتی
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36);
  }

  private hashEdges(edges: [string, string][], seeds: string[]): string {
    return this.hashText(JSON.stringify(edges) + JSON.stringify(seeds));
  }

  async health(): Promise<{ status: string } | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/health`, { timeout: 3000 }),
      );
      return response.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Backlink quality health check failed: ${message}`);
      return null;
    }
  }
}
