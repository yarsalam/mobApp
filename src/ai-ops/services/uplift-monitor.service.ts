import { Injectable, Logger } from '@nestjs/common';
import { CampaignUpliftService } from '../../seo/services/campaign-uplift.service';
import { UpliftMetrics, ServiceStatus } from '../dto/ai-quality-overview.dto';

// تایپ واقعی پاسخ health endpoint — فیلدهای اختیاری که سرویس ممکن است برگرداند
interface UpliftHealthResponse {
  status: string;
  model_trained: boolean;
  last_training_at?: string;
  confidence_score?: number;
}

@Injectable()
export class UpliftMonitorService {
  private readonly logger = new Logger(UpliftMonitorService.name);

  constructor(private readonly campaignUpliftService: CampaignUpliftService) {}

  async getMetrics(): Promise<UpliftMetrics> {
    try {
      const rawHealth = await this.campaignUpliftService.health();

      if (!rawHealth) {
        return {
          dataAvailable: false,
          status: 'down',
          modelTrained: null,
          lastTrainingAt: null,
          confidenceScore: null,
        };
      }

      // cast به interface کامل‌تر — فیلدهای اضافه در runtime ممکن است وجود داشته باشند
      // حتی اگر CampaignUpliftService آن‌ها را در تایپ خود اعلام نکرده باشد
      const health = rawHealth as UpliftHealthResponse;

      const status: ServiceStatus =
        health.status === 'healthy' || health.status === 'ok'
          ? 'healthy'
          : 'degraded';

      return {
        dataAvailable: true,
        status,
        modelTrained: health.model_trained ?? null,
        lastTrainingAt: health.last_training_at ?? null,
        confidenceScore:
          typeof health.confidence_score === 'number'
            ? health.confidence_score
            : null,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Uplift monitor metrics failed: ${message}`);
      return {
        dataAvailable: false,
        status: 'down',
        modelTrained: null,
        lastTrainingAt: null,
        confidenceScore: null,
      };
    }
  }
}
