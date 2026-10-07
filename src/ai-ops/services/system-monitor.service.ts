import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import {
  SystemMetrics,
  PerformanceIssue,
} from '../dto/ai-quality-overview.dto';

const FETCH_TIMEOUT_MS = 4000;

interface AiOpsMetricsResponse {
  system?: {
    cpu?: { average: number; count: number; percent_per_core: number[] };
    memory?: { total_gb: number; used_gb: number; percent: number };
    disk?: { total_gb: number; used_gb: number; percent: number };
  };
  app?: {
    avg_response_time: number;
    error_rate: number;
    is_available: boolean;
    sample_size?: number;
    updated_at?: string;
  };
  timestamp?: string;
}

interface AiOpsIssueResponse {
  type: string;
  value: number;
  threshold: number;
  severity: 'warning' | 'critical';
  impact: string;
  suggestion: string;
  revenue_impact: number;
  estimated_daily_loss?: number;
  estimated_monthly_loss?: number;
  priority?: string;
  detected_at: string;
}

@Injectable()
export class SystemMonitorService {
  private readonly logger = new Logger(SystemMonitorService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get('AI_OPS_URL') || 'http://ai_ops:8025';
  }

  async getSystemMetrics(): Promise<SystemMetrics> {
    try {
      const { data } = await firstValueFrom(
        this.httpService
          .get<AiOpsMetricsResponse>(`${this.baseUrl}/metrics/latest`)
          .pipe(timeout(FETCH_TIMEOUT_MS)),
      );

      const sys = data?.system;
      const app = data?.app;

      return {
        dataAvailable: true,
        cpu: sys?.cpu
          ? { average: sys.cpu.average, count: sys.cpu.count }
          : null,
        memory: sys?.memory
          ? {
              totalGb: sys.memory.total_gb,
              usedGb: sys.memory.used_gb,
              percent: sys.memory.percent,
            }
          : null,
        disk: sys?.disk
          ? {
              totalGb: sys.disk.total_gb,
              usedGb: sys.disk.used_gb,
              percent: sys.disk.percent,
            }
          : null,
        app: app
          ? {
              avgResponseTime: app.avg_response_time,
              errorRate: app.error_rate,
              isAvailable: app.is_available,
              sampleSize: app.sample_size,
            }
          : null,
        collectedAt: data?.timestamp ?? null,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`ai_ops /metrics/latest unreachable: ${message}`);
      return {
        dataAvailable: false,
        cpu: null,
        memory: null,
        disk: null,
        app: null,
        collectedAt: null,
      };
    }
  }

  async getPerformanceIssues(): Promise<PerformanceIssue[]> {
    try {
      const { data } = await firstValueFrom(
        this.httpService
          .get<{ issues: AiOpsIssueResponse[] }>(`${this.baseUrl}/issues`)
          .pipe(timeout(FETCH_TIMEOUT_MS)),
      );

      return (data?.issues ?? []).map((i) => ({
        type: i.type,
        value: i.value,
        threshold: i.threshold,
        severity: i.severity,
        impact: i.impact,
        suggestion: i.suggestion,
        revenueImpact: i.revenue_impact,
        estimatedDailyLoss: i.estimated_daily_loss,
        estimatedMonthlyLoss: i.estimated_monthly_loss,
        priority: i.priority as PerformanceIssue['priority'],
        detectedAt: i.detected_at,
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`ai_ops /issues unreachable: ${message}`);
      return [];
    }
  }
}
