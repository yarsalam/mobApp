import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  GoneException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { FeatureService } from 'src/user-metrics/feature.service';

@Controller('admin-api/growth/monetization')
@UseGuards(AdminApiGuard)
export class MonetizationController {
  private readonly aiMonUrl: string;
  private readonly featureSchemaVersion = 3;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly featureService: FeatureService,
  ) {
    this.aiMonUrl =
      this.config.get('AI_MONETIZATION_URL') || 'http://ai_monetization:8015';
  }

  @Post('predict')
  async predict(
    @Body() body: { userId: number; candidates: string[]; context?: Record<string, unknown> },
  ) {
    if (!Number.isSafeInteger(body.userId) || body.userId <= 0) {
      throw new BadRequestException('userId must be a positive integer');
    }
    if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
      throw new BadRequestException('At least one promotion candidate is required');
    }

    const features = await this.featureService.getUserFeatures(body.userId);
    const { data } = await firstValueFrom(
      this.http.post(`${this.aiMonUrl}/api/predict-promotion`, {
        user_id: body.userId,
        features,
        candidates: body.candidates,
        context: body.context || {},
        feature_schema_version: this.featureSchemaVersion,
      }),
    );
    return data;
  }

  @Post('feedback')
  async sendFeedback(
    @Body()
    body: {
      userId: number;
      variant: string;
      features: Record<string, number>;
      promotionId?: string;
      feedbackId?: string;
      eventType?: 'shown' | 'click' | 'dismiss' | 'conversion' | 'non_conversion';
      label?: 0 | 1;
      experimentId?: string;
      assignmentId?: string;
      propensity?: number;
      outcomeWindowComplete?: boolean;
      context?: Record<string, unknown>;
    },
  ) {
    if (!Number.isSafeInteger(body.userId) || body.userId <= 0) {
      throw new BadRequestException('userId must be a positive integer');
    }
    if (!body.features || typeof body.features !== 'object') {
      throw new BadRequestException('The pre-exposure feature snapshot is required');
    }

    const { data } = await firstValueFrom(
      this.http.post(`${this.aiMonUrl}/api/feedback`, {
        user_id: body.userId,
        variant: body.variant,
        features: body.features,
        promotion_id: body.promotionId,
        feedback_id: body.feedbackId || randomUUID(),
        event_type: body.eventType || 'dismiss',
        label: body.label,
        experiment_id: body.experimentId,
        assignment_id: body.assignmentId,
        propensity: body.propensity,
        outcome_window_complete: body.outcomeWindowComplete === true,
        context: body.context || {},
      }),
    );
    return data;
  }

  @Get('feedback-count')
  getFeedbackCount() {
    return firstValueFrom(this.http.get(`${this.aiMonUrl}/api/feedback/count`))
      .then((response) => response.data);
  }

  @Post('retrain')
  retrain() {
    return firstValueFrom(
      this.http.post(`${this.aiMonUrl}/api/retrain-from-feedback`, {}),
    ).then((response) => response.data);
  }

  @Post('train')
  train() {
    throw new GoneException(
      'Synthetic training is disabled. Use randomized experiment outcomes and the retrain endpoint.',
    );
  }
}
