import { Injectable } from '@nestjs/common';
import { RedisMonitorService } from './services/redis-monitor.service';
import { EmbeddedAiMonitorService } from './services/embedded-ai-monitor.service';
import { MlMonitorService } from './services/ml-monitor.service';
import { UpliftMonitorService } from './services/uplift-monitor.service';
import { SystemMonitorService } from './services/system-monitor.service';
import { AiQualityOverviewDto } from './dto/ai-quality-overview.dto';

@Injectable()
export class AiOpsService {
  constructor(
    private readonly redisMonitor: RedisMonitorService,
    private readonly embeddedAiMonitor: EmbeddedAiMonitorService,
    private readonly mlMonitor: MlMonitorService,
    private readonly upliftMonitor: UpliftMonitorService,
    private readonly systemMonitor: SystemMonitorService,
  ) {}

  async getOverview(): Promise<AiQualityOverviewDto> {
    const [redis, embeddedAi, mlService, uplift, system, performanceIssues] =
      await Promise.all([
        this.redisMonitor.getMetrics(),
        this.embeddedAiMonitor.getMetrics(),
        this.mlMonitor.getMetrics(),
        this.upliftMonitor.getMetrics(),
        this.systemMonitor.getSystemMetrics(),
        this.systemMonitor.getPerformanceIssues(),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      redis,
      embeddedAi,
      mlService,
      uplift,
      system,
      performanceIssues,
      // هیچ زیرساخت رصد هزینه‌ی LLM در پروژه وجود ندارد — صادقانه اعلام می‌شود
      llmCost: {
        dataAvailable: false,
        todayCost: null,
        monthCost: null,
        requestsToday: null,
      },
    };
  }
}
