import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';

@Processor('ai-jobs')
@Injectable()
export class AiJobProcessor extends WorkerHost {
  private readonly logger = new Logger(AiJobProcessor.name);

  async process(job: Job<any>): Promise<any> {
    this.logger.log(`AI Job received: ${job.name}`);

    switch (job.name) {
      case 'analyze-user-behavior':
        return { result: `Analyzed behavior for user ${job.data.userId}` };

      case 'generate-recommendations':
        return {
          result: `Generated recommendations for user ${job.data.userId}`,
        };

      default:
        this.logger.warn(`Unknown job: ${job.name}`);
        return null;
    }
  }
}
