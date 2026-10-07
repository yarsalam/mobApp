import { Injectable, Logger, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { RedisMonitorMetrics } from '../dto/ai-quality-overview.dto';

// کلید index برداری که embedded_ai/redis_vector_store.py با آن کار می‌کند
const VECTOR_INDEX_KEY = 'vec:index';

// پارس ساده‌ی خروجی خام INFO redis (فرمت key:value با \r\n)
function parseRedisInfo(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\r\n')) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    result[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return result;
}

@Injectable()
export class RedisMonitorService {
  private readonly logger = new Logger(RedisMonitorService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async getMetrics(): Promise<RedisMonitorMetrics> {
    try {
      const [vectorCount, memoryInfoRaw, statsInfoRaw] = await Promise.all([
        this.redis.scard(VECTOR_INDEX_KEY),
        this.redis.info('memory'),
        this.redis.info('stats'),
      ]);

      const memoryInfo = parseRedisInfo(memoryInfoRaw);
      const statsInfo = parseRedisInfo(statsInfoRaw);

      const usedBytes = Number(memoryInfo['used_memory']);
      const peakBytes = Number(memoryInfo['used_memory_peak']);
      const hits = Number(statsInfo['keyspace_hits']);
      const misses = Number(statsInfo['keyspace_misses']);
      const evicted = Number(statsInfo['evicted_keys']);

      const totalLookups = hits + misses;
      const hitRate =
        totalLookups > 0 ? Math.round((hits / totalLookups) * 1000) / 10 : null;

      return {
        dataAvailable: true,
        vectorCount: Number.isFinite(vectorCount) ? vectorCount : null,
        memoryUsedMb: Number.isFinite(usedBytes)
          ? Math.round((usedBytes / 1024 / 1024) * 10) / 10
          : null,
        memoryPeakMb: Number.isFinite(peakBytes)
          ? Math.round((peakBytes / 1024 / 1024) * 10) / 10
          : null,
        hitRate,
        evictedKeys: Number.isFinite(evicted) ? evicted : null,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Redis monitor metrics failed: ${message}`);
      return {
        dataAvailable: false,
        vectorCount: null,
        memoryUsedMb: null,
        memoryPeakMb: null,
        hitRate: null,
        evictedKeys: null,
      };
    }
  }

  /**
   * طول یک لیست دلخواه در Redis (استفاده می‌شود برای embedding:queue).
   * عمومی نگه داشته شده تا embedded-ai-monitor.service.ts هم بتواند صدا بزند.
   */
  async getListLength(key: string): Promise<number | null> {
    try {
      const len = await this.redis.llen(key);
      return Number.isFinite(len) ? len : null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Redis LLEN failed for ${key}: ${message}`);
      return null;
    }
  }

  /**
   * طول یک Redis Stream دلخواه (استفاده می‌شود برای ml:training:events).
   */
  async getStreamLength(key: string): Promise<number | null> {
    try {
      const len = await this.redis.xlen(key);
      return Number.isFinite(len) ? len : null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Redis XLEN failed for ${key}: ${message}`);
      return null;
    }
  }
}
