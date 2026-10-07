import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly baseUrl =
    process.env.PYTHON_AI_URL || 'http://python-ai:8000';

  constructor(private readonly httpService: HttpService) {}

  async recommend(
    userId: number,
    candidates: number[],
    weights?: { profile: number; behavior: number; social: number },
  ) {
    try {
      const resp = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/recommend`, {
          user_id: userId,
          candidates,
          weights,
        }),
      );
      return resp.data;
    } catch (err) {
      this.logger.warn(
        `ML recommend failed: ${err?.message || err}. Falling back.`,
      );
      // Fallback: برگرداندن candidates بدون رنک‌بندی
      return {
        results: candidates.map((id) => ({
          user_id: id,
          score: 0.5,
          components: {},
        })),
        source: 'fallback',
      };
    }
  }

  async embedText(text: string) {
    try {
      const res = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/embed`, { text }),
      );
      return res.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('embedText failed', message);
      throw new Error('AI service unavailable');
    }
  }

  async compareTexts(text1: string, text2: string) {
    try {
      const res = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/compare`, { text1, text2 }),
      );
      return res.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('compareText failed', message);
      throw new Error('AI service unavailable');
    }
  }

  async predict(data: { userA: number; userB: number }) {
    try {
      const res = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/predict`, data),
      );
      return res.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('predict failed', message);
      throw new Error('AI service unavailable');
    }
  }

  async train(modelName: string, datasetPath: string) {
    try {
      const res = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/train`, {
          modelName,
          datasetPath,
        }),
      );
      return res.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('train failed: ' + message);
      throw new Error('AI service unavailable');
    }
  }

  async healthCheck() {
    try {
      const res = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/health`),
      );
      return res.data;
    } catch (error: unknown) {
      return { status: 'down' };
    }
  }

  async compareById(idA: number, idB: number) {
    try {
      const res = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/similarity-by-id`, { idA, idB }),
      );
      return res.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('compareById failed', message);
      throw new Error('AI service unavailable');
    }
  }
}
