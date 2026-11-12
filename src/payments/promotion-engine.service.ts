import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout } from 'rxjs';
import { FeatureService } from '../user-metrics/feature.service';
import { PromotionExposureService } from './promotion-exposure.service';

const PROMOTION_FEATURE_SCHEMA_VERSION = 2;
const SCORE_KINDS = ['model_probability', 'heuristic_priority'] as const;

interface DecisionResult {
  variant: string | null;
  score: number;
  scoreKind?: (typeof SCORE_KINDS)[number];
  modelStatus?: string;
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
        this.httpService
          .post(
            `${this.mlUrl}/api/predict-promotion`,
            {
              user_id: userId,
              features,
              candidates: validVariants,
              context: context || {},
              feature_schema_version: PROMOTION_FEATURE_SCHEMA_VERSION,
            },
          )
          .pipe(timeout(5000)),
      );

      const result = response.data as {
        variant?: string;
        score?: number;
        all_scores?: VariantScore[];
        score_kind?: string;
        model_status?: string;
        feature_schema_version?: number;
      };

      if (
        result?.feature_schema_version !== PROMOTION_FEATURE_SCHEMA_VERSION ||
        !SCORE_KINDS.includes(result?.score_kind as (typeof SCORE_KINDS)[number]) ||
        !['ready', 'missing'].includes(result?.model_status ?? '') ||
        !validVariants.includes(result?.variant ?? '') ||
        !Number.isFinite(result?.score) ||
        (result.score as number) < 0 ||
        (result.score as number) > 1 ||
        !Array.isArray(result.all_scores)
      ) {
        throw new Error('AI Monetization response violates the v2 promotion contract');
      }

      const seen = new Set<string>();
      for (const item of result.all_scores) {
        if (
          !validVariants.includes(item.variant) ||
          seen.has(item.variant) ||
          !Number.isFinite(item.score) ||
          item.score < 0 ||
          item.score > 1
        ) {
          throw new Error('AI Monetization returned invalid candidate scores');
        }
        seen.add(item.variant);
      }
      if (seen.size !== validVariants.length) {
        throw new Error('AI Monetization did not score every eligible candidate');
      }

      if (
        (result.score_kind === 'model_probability' && result.model_status !== 'ready') ||
        (result.score_kind === 'heuristic_priority' && result.model_status !== 'missing')
      ) {
        throw new Error('AI Monetization model status and score kind are inconsistent');
      }

      this.logger.debug(
        `Promotion decision user=${userId} best=${result.variant} score=${result.score.toFixed(3)} kind=${result.score_kind} model=${result.model_status}`,
      );

      // The threshold is an operational display guard, not a calibrated
      // conversion-probability threshold when score_kind is heuristic_priority.
      if (result.score < 0.3) {
        return {
          variant: null,
          score: result.score,
          scoreKind: result.score_kind as DecisionResult['scoreKind'],
          modelStatus: result.model_status,
        };
      }

      return {
        variant: result.variant,
        score: result.score,
        scoreKind: result.score_kind as DecisionResult['scoreKind'],
        modelStatus: result.model_status,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Promotion scoring unavailable; fail closed: ${message}`);
      // The Python service owns the one canonical heuristic. If it is
      // unavailable or violates the contract, do not invent a second score.
      return { variant: null, score: 0, modelStatus: 'unavailable' };
    }
  }
}
