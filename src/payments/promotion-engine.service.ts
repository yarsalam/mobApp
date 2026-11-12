import { randomInt, randomUUID } from 'crypto';
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
  experimentId?: string;
  assignmentId?: string;
  propensity?: number;
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
      const bestVariant = typeof result?.variant === 'string' ? result.variant : '';
      const bestScore = typeof result?.score === 'number' ? result.score : Number.NaN;
      const scoreKind = typeof result?.score_kind === 'string' ? result.score_kind : '';
      const modelStatus = typeof result?.model_status === 'string' ? result.model_status : '';
      const allScores = result?.all_scores;

      if (
        result?.feature_schema_version !== PROMOTION_FEATURE_SCHEMA_VERSION ||
        !SCORE_KINDS.includes(scoreKind as (typeof SCORE_KINDS)[number]) ||
        !['ready', 'missing'].includes(modelStatus) ||
        !validVariants.includes(bestVariant) ||
        !Number.isFinite(bestScore) ||
        bestScore < 0 ||
        bestScore > 1 ||
        !Array.isArray(allScores)
      ) {
        throw new Error('AI Monetization response violates the v2 promotion contract');
      }

      const seen = new Set<string>();
      for (const item of allScores) {
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

      const actualBest = [...allScores].sort((a, b) => b.score - a.score)[0];
      if (
        actualBest.variant !== bestVariant ||
        Math.abs(actualBest.score - bestScore) > 1e-6
      ) {
        throw new Error('AI Monetization winner does not match all_scores');
      }

      if (
        (scoreKind === 'model_probability' && modelStatus !== 'ready') ||
        (scoreKind === 'heuristic_priority' && modelStatus !== 'missing')
      ) {
        throw new Error('AI Monetization model status and score kind are inconsistent');
      }

      this.logger.debug(
        `Promotion decision user=${userId} best=${bestVariant} score=${bestScore.toFixed(3)} kind=${scoreKind} model=${modelStatus}`,
      );

      // Optional randomized exploration is disabled by default. When
      // explicitly enabled in isolated staging, it records assignment and
      // propensity so only randomized outcomes can enter model training.
      const experimentEnabled =
        this.configService.get('PROMOTION_EXPERIMENT_ENABLED', 'false') === 'true';
      const experimentRate = Number(
        this.configService.get('PROMOTION_EXPERIMENT_RATE', '0'),
      );
      const experimentCandidates = allScores.filter((item) => item.score >= 0.3);
      const enterExperiment =
        experimentEnabled &&
        Number.isFinite(experimentRate) &&
        experimentRate > 0 &&
        experimentRate <= 1 &&
        experimentCandidates.length > 1 &&
        randomInt(1_000_000) / 1_000_000 < experimentRate;

      if (enterExperiment) {
        const selected = experimentCandidates[randomInt(experimentCandidates.length)];
        return {
          variant: selected.variant,
          score: selected.score,
          scoreKind: scoreKind as DecisionResult['scoreKind'],
          modelStatus,
          experimentId: this.configService.get(
            'PROMOTION_EXPERIMENT_ID',
            'promotion-v2-staging',
          ),
          assignmentId: randomUUID(),
          propensity: 1 / experimentCandidates.length,
        };
      }

      // This is an operational display guard, not a calibrated conversion
      // probability threshold when score_kind is heuristic_priority.
      if (bestScore < 0.3) {
        return {
          variant: null,
          score: bestScore,
          scoreKind: scoreKind as DecisionResult['scoreKind'],
          modelStatus,
        };
      }

      return {
        variant: bestVariant,
        score: bestScore,
        scoreKind: scoreKind as DecisionResult['scoreKind'],
        modelStatus,
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
