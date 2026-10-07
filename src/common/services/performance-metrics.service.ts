import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

const METRIC_KEY = 'app:performance';
// با این کلید، Python از طریق get_metric("app:performance") → می‌خونه metric:app:performance
const FLUSH_INTERVAL_MS = 60_000; // هم‌تراز با WORKER_INTERVALS.metrics در ai_ops/config/settings.py
const REDIS_TTL_SECONDS = 120;

@Injectable()
export class PerformanceMetricsService implements OnModuleDestroy {
  private readonly logger = new Logger(PerformanceMetricsService.name);
  private durationsMs: number[] = [];
  private errorCount = 0;
  private totalCount = 0;
  private readonly flushTimer: NodeJS.Timeout;

  constructor(private readonly redis: RedisService) {
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  record(durationMs: number, isError: boolean): void {
    this.durationsMs.push(durationMs);
    this.totalCount += 1;
    if (isError) this.errorCount += 1;
  }

  private async flush(): Promise<void> {
    if (this.totalCount === 0) return; // این پنجره ریکوئستی نداشته، چیزی برای نوشتن نیست

    const avgResponseTimeMs =
      this.durationsMs.reduce((a, b) => a + b, 0) / this.durationsMs.length;
    const errorRate = this.errorCount / this.totalCount;

    const payload = {
      avg_response_time: Math.round(avgResponseTimeMs * 100) / 100,
      error_rate: Math.round(errorRate * 10000) / 10000,
      sample_size: this.totalCount,
      window_seconds: FLUSH_INTERVAL_MS / 1000,
      updated_at: new Date().toISOString(),
    };

    try {
      await this.redis.set(
        `metric:${METRIC_KEY}`,
        JSON.stringify(payload),
        REDIS_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.error(`Failed to flush performance metrics: ${err}`);
    }

    this.durationsMs = [];
    this.errorCount = 0;
    this.totalCount = 0;
  }

  onModuleDestroy() {
    clearInterval(this.flushTimer);
  }
}
