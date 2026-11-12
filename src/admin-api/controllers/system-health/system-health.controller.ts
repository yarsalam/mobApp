import { Controller, Get, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface ServiceStatus {
  name: string;
  status: 'up' | 'down' | 'degraded';
  latencyMs: number | null;
}

// پورت‌ها از نقشه‌راه اولیه — هرکدوم که در .env واقعی فرق داره، env var معادلش رو اضافه کن
const MICROSERVICE_REGISTRY: Record<string, string> = {
  ai_monetization:
    process.env.AI_MONETIZATION_URL ?? 'http://ai_monetization:8015',
  ai_feedback: process.env.AI_FEEDBACK_URL ?? 'http://ai_feedback:8005',
  ai_assistant: process.env.AI_ASSISTANT_URL ?? 'http://ai_assistant:8000',
  aeo_tracker:
    process.env.AEO_TRACKER_URL ?? 'http://aeo_tracker:8030',
  ai_image: process.env.AI_IMAGE_URL ?? 'http://ai_image:8000',
  ai_moderation: process.env.AI_MODERATION_URL ?? 'http://ai_moderation:8000',
  ai_ops: process.env.AI_OPS_URL ?? 'http://ai_ops:8025',
  ai_revenue: process.env.AI_REVENUE_URL ?? 'http://ai_revenue:8000',
  ai_support: process.env.AI_SUPPORT_URL ?? 'http://ai_support:8000',
  ai_uplift: process.env.AI_UPLIFT_URL ?? 'http://ai_uplift:8000',
  ai_verification:
    process.env.AI_VERIFICATION_URL ?? 'http://ai_verification:8000',
  embedded_ai: process.env.EMBEDDED_AI_URL ?? 'http://embedded_ai:8000',
  ml_service: process.env.ML_SERVICE_URL ?? 'http://ml_service:8000',
  personality: process.env.PERSONALITY_URL ?? 'http://personality:8000',
};

const HEALTH_CHECK_TIMEOUT_MS = 3000;
const DEGRADED_THRESHOLD_MS = 1500;

@Controller('admin-api/system-health')
export class SystemHealthController {
  private readonly logger = new Logger(SystemHealthController.name);

  constructor(private readonly http: HttpService) {}

  @Get('overview')
  async getOverview() {
    const aiOpsUrl = MICROSERVICE_REGISTRY.ai_ops;

    const [metricsResult, issuesResult] = await Promise.allSettled([
      firstValueFrom(
        this.http.get(`${aiOpsUrl}/metrics/latest`, {
          timeout: HEALTH_CHECK_TIMEOUT_MS,
        }),
      ),
      firstValueFrom(
        this.http.get(`${aiOpsUrl}/issues`, {
          timeout: HEALTH_CHECK_TIMEOUT_MS,
        }),
      ),
    ]);

    // 👇 همون نکته‌ی بالای پیام: یک لایه‌ی "system" بیرونی، و داخلش دوباره "system"
    const collectorOutput =
      metricsResult.status === 'fulfilled'
        ? metricsResult.value.data.system
        : null;

    const issues =
      issuesResult.status === 'fulfilled' ? issuesResult.value.data.issues : [];

    if (metricsResult.status === 'rejected') {
      this.logger.warn(
        `ai_ops metrics/latest unreachable: ${metricsResult.reason}`,
      );
    }

    return {
      system: collectorOutput?.system ?? null, // { cpu, memory, disk }
      app: collectorOutput?.app ?? {
        avg_response_time: null,
        error_rate: null,
        is_available: false,
      },
      issues: issues ?? [],
      lastUpdated: collectorOutput?.timestamp ?? null,
      dataAvailable: metricsResult.status === 'fulfilled' && !!collectorOutput,
    };
  }


  @Get('retired-services')
  getRetiredServices() {
    return {
      status: 'retired',
      services: [
        { name: 'ai_seo', replacement: 'NestJS AcquisitionGrowthService and evidence-based technical SEO' },
        { name: 'ai_seo_recommender', replacement: 'Product recommendation and Matching modules' },
        { name: 'ai_backlink_quality', replacement: 'Referral acquisition measurement; no backlink score' },
      ],
    };
  }

  @Get('services-status')
  async getServicesStatus(): Promise<ServiceStatus[]> {
    const entries = Object.entries(MICROSERVICE_REGISTRY);

    const results = await Promise.allSettled(
      entries.map(async ([, url]) => {
        const start = Date.now();
        await firstValueFrom(
          this.http.get(`${url}/health`, { timeout: HEALTH_CHECK_TIMEOUT_MS }),
        );
        return { latencyMs: Date.now() - start };
      }),
    );

    return results.map((result, i) => {
      const [name] = entries[i];
      if (result.status === 'rejected')
        return { name, status: 'down', latencyMs: null };
      const { latencyMs } = result.value;
      return {
        name,
        status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'up',
        latencyMs,
      };
    });
  }
}
