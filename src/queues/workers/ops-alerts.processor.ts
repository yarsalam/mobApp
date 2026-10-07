import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { NotificationService } from '../../notification/notification.service';

@Processor('ops-alerts')
export class OpsAlertsProcessor extends WorkerHost {
  private readonly logger = new Logger(OpsAlertsProcessor.name);

  constructor(private readonly notificationService: NotificationService) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    const { alerts } = job.data;
    this.logger.warn(`Received ${alerts?.length ?? 0} alerts from ai_ops`);

    for (const alert of alerts ?? []) {
      this.logger.log(`Alert: ${JSON.stringify(alert)}`);
    }

    return { processed: true };
  }
}
