import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Controller('admin-api/growth/monetization')
@UseGuards(AdminApiGuard)
export class MonetizationController {
  private aiMonUrl: string;
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.aiMonUrl =
      this.config.get('AI_MONETIZATION_URL') || 'http://ai_monetization:8015';
  }

  @Post('predict')
  predict(
    @Body() body: { userId: number; features: any; candidates: string[] },
  ) {
    return firstValueFrom(
      this.http.post(`${this.aiMonUrl}/api/predict-promotion`, body),
    )
      .then((r) => r.data)
      .catch(() => null);
  }

  @Post('feedback')
  sendFeedback(
    @Body()
    body: {
      userId: number;
      variant: string;
      features: any;
      label: number;
    },
  ) {
    return firstValueFrom(this.http.post(`${this.aiMonUrl}/api/feedback`, body))
      .then((r) => r.data)
      .catch(() => null);
  }

  @Get('feedback-count')
  getFeedbackCount() {
    return firstValueFrom(this.http.get(`${this.aiMonUrl}/api/feedback/count`))
      .then((r) => r.data)
      .catch(() => ({ count: 0 }));
  }

  @Post('retrain')
  retrain() {
    return firstValueFrom(
      this.http.post(`${this.aiMonUrl}/api/retrain-from-feedback`, {}),
    )
      .then((r) => r.data)
      .catch(() => null);
  }

  @Post('train')
  train() {
    return firstValueFrom(
      this.http.post(`${this.aiMonUrl}/api/train-model`, {}),
    )
      .then((r) => r.data)
      .catch(() => null);
  }
}
