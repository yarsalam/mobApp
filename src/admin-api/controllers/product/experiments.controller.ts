// backend/src/admin-api/controllers/product/experiments.controller.ts
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Controller('admin-api/product/experiments')
@UseGuards(AdminApiGuard)
export class ExperimentsController {
  private aiMonUrl: string;
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.aiMonUrl =
      this.config.get('AI_MONETIZATION_URL') || 'http://ai_monetization:8015';
  }

  @Post('run-ab')
  async runAB(
    @Body() body: { userId: number; variantA: string; variantB: string },
  ) {
    try {
      const { data } = await firstValueFrom(
        this.http.post(`${this.aiMonUrl}/api/predict-promotion`, {
          user_id: body.userId,
          features: {}, // در دنیای واقعی از feature store می‌آید
          candidates: [body.variantA, body.variantB],
        }),
      );
      return data;
    } catch {
      return null;
    }
  }
}
