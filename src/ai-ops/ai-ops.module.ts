import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SEOModule } from '../seo/seo.module';
import { AiOpsService } from './ai-ops.service';
import { RedisMonitorService } from './services/redis-monitor.service';
import { EmbeddedAiMonitorService } from './services/embedded-ai-monitor.service';
import { MlMonitorService } from './services/ml-monitor.service';
import { UpliftMonitorService } from './services/uplift-monitor.service';
import { SystemMonitorService } from './services/system-monitor.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
    SEOModule,
  ],
  providers: [
    AiOpsService,
    RedisMonitorService,
    EmbeddedAiMonitorService,
    MlMonitorService,
    UpliftMonitorService,
    SystemMonitorService,
  ],
  exports: [AiOpsService],
})
export class AiOpsModule {}
