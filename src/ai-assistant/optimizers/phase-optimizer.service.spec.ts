import { describe, expect, it, jest } from '@jest/globals';
import { PhaseOptimizerService } from './phase-optimizer.service';

describe('PhaseOptimizerService time estimate', () => {
  const service = new PhaseOptimizerService(
    {} as any,
    {} as any,
    {} as any,
    { log: jest.fn(async () => undefined) } as any,
    {} as any,
  );

  it('does not estimate days to the next phase without a calibrated duration model', async () => {
    const result = await service.createOptimizationPlanWithData(7, [], {
      phase: 'warm',
      score: 10,
      nextPhaseThreshold: 15,
    });
    expect(result.estimatedTimeToNextPhase).toBeNull();
  });

  it('reports the highest recorded phase without inventing a duration', async () => {
    const result = await service.createOptimizationPlanWithData(7, [], {
      phase: 'hot',
      score: 100,
      nextPhaseThreshold: null,
    });
    expect(result.estimatedTimeToNextPhase).toContain('بالاترین فاز');
  });
});
