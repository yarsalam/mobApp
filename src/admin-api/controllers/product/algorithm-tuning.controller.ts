import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { PhaseService } from '../../../phase/phase.service';
import { FeatureStoreService } from '../../../feature-store/feature-store.service';
import { SuggestionService } from '../../../suggestion/suggestion.service';
import { DiversityOptimizerService } from 'src/suggestion/optimization/diversity-optimizer.service';
import { PhaseWeights } from 'src/phase/types/phase.interface';

@Controller('admin-api/product/algorithm-tuning')
@UseGuards(AdminApiGuard)
export class AlgorithmTuningController {
  constructor(
    private readonly phaseService: PhaseService,
    private readonly featureStore: FeatureStoreService,
    private readonly diversityOptimizer: DiversityOptimizerService,
    private readonly suggestionService: SuggestionService,
  ) {}

  @Get('phase-weights')
  async getPhaseWeights() {
    try {
      return await this.phaseService.getAllWeights();
    } catch {
      return {};
    }
  }

  @Post('phase-weights')
  async setPhaseWeight(@Body() body: { key: string; value: number }) {
    const validKeys: (keyof PhaseWeights)[] = [
      'matches',
      'messages',
      'views',
      'retentionDays',
      'boostUsed',
      'cityUsers',
      'learningScore',
      'profileCompleteness',
      'sentimentScore',
    ];
    if (!validKeys.includes(body.key as any)) {
      throw new BadRequestException(`Invalid key: ${body.key}`);
    }
    return this.phaseService.setWeight(
      body.key as keyof PhaseWeights,
      body.value,
    );
  }

  @Get('feature-weights')
  async getFeatureWeights(@Query('type') type: string) {
    try {
      const defaults = type.includes('profile')
        ? Array(10).fill(1)
        : Array(5).fill(1);
      return await this.featureStore.getWeightArray(
        `feature:weights:${type}`,
        defaults,
      );
    } catch {
      return [];
    }
  }

  @Post('feature-weights')
  async updateFeatureWeight(
    @Body() body: { type: string; index: number; value: number },
  ) {
    // await this.featureStore.learnFeatureWeights(body.type as any, [
    //   { index: body.index, value: body.value },
    // ]);
    return { success: true };
  }

  private async getUserInteractionCount(): Promise<number> {
    // مثلاً از سرویس InteractionsService بگیرید
    return 100; // placeholder
  }

  @Get('diversity')
  async getDiversityParams() {
    try {
      const interactions = await this.getUserInteractionCount();
      const epsilon =
        await this.diversityOptimizer.getAdaptiveEpsilon(interactions);
      return { epsilon };
    } catch {
      return { epsilon: 0.1 };
    }
  }

  @Post('diversity')
  async updateDiversityParams(@Body() params: any) {
    // این متد قابل توسعه است
    return { success: true };
  }

  @Post('test-scores')
  async testScores(@Body() body: { userId: number; candidateIds: number[] }) {
    try {
      const suggestions = await this.suggestionService.getSuggestionsForUser(
        body.userId,
      );
      return suggestions;
    } catch {
      return [];
    }
  }

  @Get('user-features')
  async getUserFeatures(@Query('userId') userId: number) {
    try {
      return await this.featureStore.getUserFeatures(userId);
    } catch {
      return null;
    }
  }
}