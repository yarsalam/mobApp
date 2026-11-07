import { RevenueAnalyticsService } from './revenue-analytics.service';

describe('RevenueAnalyticsService forecast accuracy', () => {
  const createService = () =>
    new RevenueAnalyticsService({} as any, {} as any, {} as any);

  it('does not report accuracy when the observed history is too short', async () => {
    const service = createService();
    const result = await service.forecastAccuracy(
      Array.from({ length: 14 }, (_, index) => ({
        date: `2026-10-${String(index + 1).padStart(2, '0')}`,
        amount: 100,
      })),
    );

    expect(result.dataAvailable).toBe(false);
    expect(result.mape).toBeNull();
    expect(result.rmse).toBeNull();
  });

  it('evaluates a 7-day rolling mean against held-out actual revenue', async () => {
    const service = createService();
    const history = [
      ...Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(index + 1).padStart(2, '0')}`,
        amount: 100,
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        date: `2026-10-${String(index + 8).padStart(2, '0')}`,
        amount: 200,
      })),
    ];

    const result = await service.forecastAccuracy(history, 'IRT');

    expect(result.dataAvailable).toBe(true);
    expect(result.currency).toBe('IRT');
    expect(result.evaluationSamples).toBe(8);
    expect(result.mape).toBe(25);
    expect(result.rmse).toBeCloseTo(59.76, 2);
    expect(result.history[0]).toMatchObject({
      predicted: 100,
      actual: 200,
      error: 100,
    });
  });

  it('excludes zero-actual days from MAPE while retaining them in RMSE', async () => {
    const service = createService();
    const history = [
      ...Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(index + 1).padStart(2, '0')}`,
        amount: 0,
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        date: `2026-10-${String(index + 8).padStart(2, '0')}`,
        amount: 0,
      })),
    ];

    const result = await service.forecastAccuracy(history);

    expect(result.dataAvailable).toBe(true);
    expect(result.mape).toBeNull();
    expect(result.rmse).toBe(0);
  });
});
