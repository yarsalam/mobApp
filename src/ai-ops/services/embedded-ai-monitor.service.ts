import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import {
  EmbeddedAiMetrics,
  ServiceStatus,
} from '../dto/ai-quality-overview.dto';
import { RedisMonitorService } from './redis-monitor.service';

const EMBEDDING_QUEUE_KEY = 'embedding:queue';
const HEALTH_TIMEOUT_MS = 3000;

interface EmbeddedAiHealthResponse {
  status: string;
  service: string;
  model_loaded: boolean;
  redis: boolean;
  uptime?: string;
  avg_embedding_latency?: string;
}

@Injectable()
export class EmbeddedAiMonitorService {
  private readonly logger = new Logger(EmbeddedAiMonitorService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly redisMonitor: RedisMonitorService,
  ) {
    this.baseUrl =
      this.configService.get('EMBEDDED_AI_URL') || 'http://embedded_ai:8100';
  }

  async getMetrics(): Promise<EmbeddedAiMetrics> {
    const [healthResult, queueLength] = await Promise.allSettled([
      firstValueFrom(
        this.httpService
          .get<EmbeddedAiHealthResponse>(`${this.baseUrl}/health`)
          .pipe(timeout(HEALTH_TIMEOUT_MS)),
      ),
      this.redisMonitor.getListLength(EMBEDDING_QUEUE_KEY),
    ]);

    if (healthResult.status === 'rejected') {
      this.logger.warn(
        `embedded_ai /health unreachable: ${healthResult.reason}`,
      );
      return {
        dataAvailable: false,
        status: 'down',
        modelLoaded: null,
        redisOk: null,
        queueLength:
          queueLength.status === 'fulfilled' ? queueLength.value : null,
        uptime: null,
        avgEmbeddingLatency: null,
      };
    }

    const health = healthResult.value.data;
    const status: ServiceStatus =
      health.status === 'healthy' && health.model_loaded && health.redis
        ? 'healthy'
        : health.status === 'healthy'
          ? 'degraded'
          : 'down';

    return {
      dataAvailable: true,
      status,
      modelLoaded: health.model_loaded ?? null,
      redisOk: health.redis ?? null,
      queueLength:
        queueLength.status === 'fulfilled' ? queueLength.value : null,
      // این دو فیلد حالا از health endpoint پر می‌شوند اگر سرویس آن‌ها را برگرداند
      uptime: health.uptime ?? null,
      avgEmbeddingLatency: health.avg_embedding_latency ?? null,
    };
  }
}
