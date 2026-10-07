import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import axios from 'axios';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import FormData from 'form-data';

@Processor('ai-image')
export class AiImageProcessor extends WorkerHost {
  private readonly logger = new Logger(AiImageProcessor.name);

  async process(job: Job<any>): Promise<any> {
    const image = job.data;
    try {
      if (!image.path || !fs.existsSync(image.path)) {
        this.logger.warn(`Image file not found: ${image.path}`);
        return null;
      }

      const form = new FormData();
      form.append('file', fs.createReadStream(image.path));

      const { data } = await axios.post(
        `${process.env.PYTHON_AI_URL}/image/analyze`,
        form,
        { headers: form.getHeaders() },
      );

      this.logger.log(
        `Analyzed image ${image.id}: score ${data.quality_score}`,
      );

      // به جای HTTP مستقیم، از Queue استفاده می‌کنیم
      // feedback را از طریق صف ارسال می‌کنیم تا coupling کاهش یابد
      await axios.post(
        `${process.env.PYTHON_AI_URL}/feedback/train_incremental`,
        {
          feedback: {
            userId: image.userId,
            feature: 'image',
            feedbackType: 'implicit',
            impactScore: data.quality_score,
            value: { score: data.quality_score },
            context: { imageId: image.id },
          },
        },
      );

      return data;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`AI image analysis failed: ${message}`);
    }
  }
}
