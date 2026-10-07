import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import {
  MlServiceMetrics,
  ServiceStatus,
} from '../dto/ai-quality-overview.dto';
import { RedisMonitorService } from './redis-monitor.service';

const TRAINING_EVENTS_STREAM_KEY = 'ml:training:events';
const HEALTH_TIMEOUT_MS = 3000;

interface MlServiceHealthResponse {
  status: string;
  service: string;
  // فیلدهای اختیاری که ml_service ممکن است اضافه کند
  matching_jobs_per_hour?: number;
  avg_matching_latency?: string;
  failed_jobs?: number;
}

@Injectable()
export class MlMonitorService {
  private readonly logger = new Logger(MlMonitorService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly redisMonitor: RedisMonitorService,
  ) {
    this.baseUrl =
      this.configService.get('ML_SERVICE_URL') || 'http://ml_service:8000';
  }

  async getMetrics(): Promise<MlServiceMetrics> {
    const [healthResult, eventCount] = await Promise.allSettled([
      firstValueFrom(
        this.httpService
          .get<MlServiceHealthResponse>(`${this.baseUrl}/health`)
          .pipe(timeout(HEALTH_TIMEOUT_MS)),
      ),
      this.redisMonitor.getStreamLength(TRAINING_EVENTS_STREAM_KEY),
    ]);

    if (healthResult.status === 'rejected') {
      this.logger.warn(
        `ml_service /health unreachable: ${healthResult.reason}`,
      );
      return {
        dataAvailable: false,
        status: 'down',
        trainingEventCount:
          eventCount.status === 'fulfilled' ? eventCount.value : null,
        matchingJobsPerHour: null,
        avgMatchingLatency: null,
        failedJobs: null,
      };
    }

    const health = healthResult.value.data;
    const status: ServiceStatus =
      health.status === 'healthy' ? 'healthy' : 'degraded';

    return {
      dataAvailable: true,
      status,
      trainingEventCount:
        eventCount.status === 'fulfilled' ? eventCount.value : null,
      // این سه فیلد از health endpoint پر می‌شوند اگر ml_service آن‌ها را برگرداند
      matchingJobsPerHour: health.matching_jobs_per_hour ?? null,
      avgMatchingLatency: health.avg_matching_latency ?? null,
      failedJobs: health.failed_jobs ?? null,
    };
  }
}
