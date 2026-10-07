import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import axios from 'axios';
import { Logger } from '@nestjs/common';

@Processor('ai-feedback')
export class AiFeedbackProcessor extends WorkerHost {
  private readonly logger = new Logger(AiFeedbackProcessor.name);

  async process(job: Job<any, any, string>): Promise<any> {
    try {
      const feedback = job.data;
      const res = await axios.post(
        `${process.env.PYTHON_AI_URL}/feedback/train_incremental`,
        { feedback },
      );
      this.logger.log(
        `Sent feedback ${feedback.id} to ML service: ${res.status}`,
      );
      return res.data;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`ML feedback send failed: ${message}`);
      throw e;
    }
  }
}
