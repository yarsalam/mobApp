// backend/src/admin-api/controllers/product/feedback.controller.ts
import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { ConversionAnalyticsService } from '../../../ai-feedback/services/conversion-analytics.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Controller('admin-api/product/feedback')
@UseGuards(AdminApiGuard)
export class FeedbackController {
  private aiFeedbackUrl: string;
  constructor(
    private readonly conversionAnalytics: ConversionAnalyticsService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.aiFeedbackUrl =
      this.config.get('AI_FEEDBACK_URL') || 'http://ai_feedback:8005';
  }

  @Get('metrics')
  async getMetrics() {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`${this.aiFeedbackUrl}/feedback/metrics`),
      );
      return data;
    } catch {
      return {};
    }
  }

  @Get('conversion-insights')
  async getConversionInsights() {
    try {
      return await this.conversionAnalytics.analyzeConversion();
    } catch {
      return [];
    }
  }

  @Get('top-features')
  async getTopFeatures() {
    try {
      return await this.conversionAnalytics.getTopPerformingFeatures();
    } catch {
      return [];
    }
  }

  @Post('train-incremental')
  async trainIncremental(@Body() feedback: any) {
    try {
      const { data } = await firstValueFrom(
        this.http.post(
          `${this.aiFeedbackUrl}/feedback/train_incremental`,
          feedback,
        ),
      );
      return data;
    } catch {
      return null;
    }
  }

  @Post('train-batch')
  async trainBatch(@Body() feedbacks: any[]) {
    try {
      const { data } = await firstValueFrom(
        this.http.post(`${this.aiFeedbackUrl}/feedback/train_batch`, feedbacks),
      );
      return data;
    } catch {
      return null;
    }
  }

  @Post('predict')
  async predict(@Body() feedback: any) {
    try {
      const { data } = await firstValueFrom(
        this.http.post(`${this.aiFeedbackUrl}/feedback/predict`, feedback),
      );
      return data;
    } catch {
      return null;
    }
  }

  @Get('list')
  async list(@Query('limit') limit = 100) {
    // فرض وجود endpoint بازخوردها در بک‌اند اصلی
    return [];
  }
}
