import { describe, expect, it, jest } from '@jest/globals';
import { RevenueAnalyticsService } from './revenue-analytics.service';

describe('RevenueAnalyticsService forecast accuracy', () => {
  const createService = () =>
    new RevenueAnalyticsService({} as any, {} as any, {} as any, {} as any);

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


describe('RevenueAnalyticsService by-product reporting', () => {
  const makeBuilder = (rows: any[]) => {
    const builder: any = {};
    for (const method of [
      'select',
      'addSelect',
      'where',
      'andWhere',
      'groupBy',
      'orderBy',
    ]) {
      builder[method] = jest.fn(() => builder);
    }
    builder.getRawMany = jest.fn(async () => rows);
    return builder;
  };

  it('includes directly paid bundle purchases even without a wallet debit event', async () => {
    const debitBuilder = makeBuilder([]);
    const fulfilledBuilder = makeBuilder([
      {
        product: 'vip_monthly',
        fulfilledRevenue: '1250000',
        fulfilledPurchaseCount: '2',
        fulfilledPayingUsers: '2',
      },
    ]);
    let queryCount = 0;
    const events: any = {
      createQueryBuilder: jest.fn(() =>
        queryCount++ === 0 ? debitBuilder : fulfilledBuilder,
      ),
    };
    const service = new RevenueAnalyticsService(
      {} as any,
      {} as any,
      {} as any,
      events,
    );

    const result = await service.byProduct('IRT', 90);

    expect(result.totalRevenue).toBe(0);
    expect(result.totalFulfilledRevenue).toBe(1_250_000);
    expect(result.fulfilledPurchaseCount).toBe(2);
    expect(result.rows).toEqual([
      expect.objectContaining({
        product: 'vip_monthly',
        revenue: 0,
        fulfilledRevenue: 1_250_000,
        fulfilledPurchaseCount: 2,
        fulfilledPayingUsers: 2,
      }),
    ]);
  });

  it('unions wallet debits and fulfilled purchases without double-counting either measure', async () => {
    const debitBuilder = makeBuilder([
      { product: 'credits_100', revenue: '400000', transactionCount: '2', payingUsers: '2' },
    ]);
    const fulfilledBuilder = makeBuilder([
      {
        product: 'credits_100',
        fulfilledRevenue: '400000',
        fulfilledPurchaseCount: '2',
        fulfilledPayingUsers: '2',
      },
      {
        product: 'vip_monthly',
        fulfilledRevenue: '900000',
        fulfilledPurchaseCount: '1',
        fulfilledPayingUsers: '1',
      },
    ]);
    let queryCount = 0;
    const events: any = {
      createQueryBuilder: jest.fn(() =>
        queryCount++ === 0 ? debitBuilder : fulfilledBuilder,
      ),
    };
    const service = new RevenueAnalyticsService(
      {} as any,
      {} as any,
      {} as any,
      events,
    );

    const result = await service.byProduct('IRT', 90);

    expect(result.totalRevenue).toBe(400_000);
    expect(result.totalFulfilledRevenue).toBe(1_300_000);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find((row) => row.product === 'credits_100')).toMatchObject({
      revenue: 400_000,
      fulfilledRevenue: 400_000,
    });
    expect(result.rows.find((row) => row.product === 'vip_monthly')).toMatchObject({
      revenue: 0,
      fulfilledRevenue: 900_000,
    });
  });
});
