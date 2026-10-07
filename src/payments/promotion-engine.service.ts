import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { FeatureService } from '../user-metrics/feature.service';
import { PromotionExposureService } from './promotion-exposure.service';

interface DecisionResult {
  variant: string | null;
  score: number;
}

interface VariantScore {
  variant: string;
  score: number;
}

@Injectable()
export class PromotionEngineService {
  private readonly logger = new Logger(PromotionEngineService.name);
  private readonly mlUrl: string;

  constructor(
    private readonly featureService: FeatureService,
    private readonly exposureService: PromotionExposureService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.mlUrl = this.configService.get(
      'AI_MONETIZATION_URL',
      'http://ai_monetization:8015',
    );
  }

  async decide(
    userId: number,
    allowedVariants: string[],
    context?: any,
  ): Promise<DecisionResult> {
    try {
      const features = await this.featureService.getUserFeatures(userId);

      const validVariants: string[] = [];
      for (const variant of allowedVariants) {
        const canShow = await this.exposureService.canShow(userId, variant);
        if (canShow) validVariants.push(variant);
      }

      if (validVariants.length === 0) return { variant: null, score: 0 };

      const response = await firstValueFrom(
        this.httpService.post(`${this.mlUrl}/api/predict-promotion`, {
          user_id: userId,
          features,
          candidates: validVariants,
          context: context || {},
        }),
      );

      const best = response.data;
      this.logger.debug(
        `ML decision for user ${userId}: ${best.variant} (${best.score.toFixed(3)})`,
      );

      if (best.score < 0.3) return { variant: null, score: best.score };
      return { variant: best.variant, score: best.score };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in ML decision: ${message}`);
      return this.ruleBasedFallback(userId, allowedVariants);
    }
  }

  private async ruleBasedFallback(
    userId: number,
    allowedVariants: string[],
  ): Promise<DecisionResult> {
    const features = await this.featureService.getUserFeatures(userId);

    const scores: VariantScore[] = allowedVariants.map((variant) => {
      let score = 0.3;
      if (variant === 'vip' && features.engagement_score > 0.7) score = 0.8;
      else if (variant === 'boost' && features.dismiss_rate < 0.3) score = 0.7;
      else if (variant === 'credit' && features.last_purchase_days > 30)
        score = 0.6;
      else if (variant === 'profile' && features.engagement_score < 0.3)
        score = 0.5;

      if (features.boostActive) {
        if (variant === 'credit' || variant === 'vip') score = 0.7;
        else if (variant === 'boost') score = 0.1;
      }
      if (features.creditsBalance > 20 && variant === 'vip') score = 0.8;
      return { variant, score };
    });

    scores.sort((a, b) => b.score - a.score);
    if (!scores[0] || scores[0].score < 0.3) return { variant: null, score: 0 };
    return scores[0];
  }
}
