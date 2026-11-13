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
      'setParameter',
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


describe('RevenueAnalyticsService historical gender attribution', () => {
  const makeBuilder = (rows: any[]) => {
    const builder: any = {};
    for (const method of ['innerJoin', 'select', 'addSelect', 'where', 'andWhere', 'groupBy']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.getRawMany = jest.fn(async () => rows);
    return builder;
  };

  it('uses purchase-time snapshots and exposes legacy fallback coverage', async () => {
    const debitBuilder = makeBuilder([]);
    const fulfilledBuilder = makeBuilder([
      {
        gender: 'female',
        fulfilledRevenue: '300000',
        fulfilledCount: '2',
        fulfilledUsers: '1',
        legacyGenderFallbackCount: '1',
      },
    ]);
    const depositBuilder = makeBuilder([]);
    let eventQuery = 0;
    const events: any = {
      createQueryBuilder: jest.fn(() =>
        eventQuery++ === 0 ? debitBuilder : fulfilledBuilder,
      ),
    };
    const payments: any = {
      createQueryBuilder: jest.fn(() => depositBuilder),
    };
    const service = new RevenueAnalyticsService(
      payments,
      {} as any,
      {} as any,
      events,
    );

    const result = await service.byGender('IRT', 90);

    expect(fulfilledBuilder.select).toHaveBeenCalledWith(
      "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.genderAtPurchase')), ''), u.gender)",
      'gender',
    );
    expect(fulfilledBuilder.addSelect).toHaveBeenCalledWith(
      expect.stringContaining("= ''"),
      'legacyGenderFallbackCount',
    );
    expect(result.female.fulfilledRevenue).toBe(300000);
    expect(result.female.fulfilledPurchaseCount).toBe(2);
    expect(result.fulfilledPurchaseLegacyGenderFallbackCount).toBe(1);
    expect(result.fulfilledPurchaseSnapshotCoveragePercent).toBe(50);
    expect(result.walletDebitGenderBasis).toContain('current user profile');
  });
});


describe('RevenueAnalyticsService customer RFM segmentation', () => {
  const makeBuilder = (rows: any[] = [], count = 0) => {
    const builder: any = {};
    for (const method of [
      'innerJoin',
      'leftJoin',
      'select',
      'addSelect',
      'where',
      'andWhere',
      'groupBy',
      'orderBy',
      'setParameter',
    ]) {
      builder[method] = jest.fn(() => builder);
    }
    builder.getRawMany = jest.fn(async () => rows);
    builder.getCount = jest.fn(async () => count);
    return builder;
  };

  it('separates period frequency/monetary value from lifetime recency and protects all past buyers', async () => {
    const now = Date.now();
    const purchaseRows = [
      { userId: '1', frequency: '3', lifetimeFrequency: '3', lastPurchaseAt: new Date(now - 2 * 86400000), monetaryRials: '9000' },
      { userId: '2', frequency: '4', lifetimeFrequency: '4', lastPurchaseAt: new Date(now - 60 * 86400000), monetaryRials: '12000' },
      { userId: '3', frequency: '2', lifetimeFrequency: '2', lastPurchaseAt: new Date(now - 5 * 86400000), monetaryRials: '5000' },
      { userId: '4', frequency: '2', lifetimeFrequency: '2', lastPurchaseAt: new Date(now - 45 * 86400000), monetaryRials: '3000' },
      { userId: '5', frequency: '1', lifetimeFrequency: '1', lastPurchaseAt: new Date(now - 1 * 86400000), monetaryRials: '1000' },
      // A historical repeat buyer with only one purchase in-window is not a first-time purchaser.
      { userId: '6', frequency: '1', lifetimeFrequency: '3', lastPurchaseAt: new Date(now - 90 * 86400000), monetaryRials: '1500' },
      { userId: '7', frequency: '0', lifetimeFrequency: '2', lastPurchaseAt: new Date(now - 120 * 86400000), monetaryRials: '0' },
    ];
    const purchaseBuilder = makeBuilder(purchaseRows);
    const neverPurchasedBuilder = makeBuilder([], 17);
    const events: any = {
      createQueryBuilder: jest.fn(() => purchaseBuilder),
    };
    const users: any = {
      count: jest.fn(async () => 24),
      createQueryBuilder: jest.fn(() => neverPurchasedBuilder),
    };
    const service = new RevenueAnalyticsService(
      {} as any,
      users,
      {} as any,
      events,
    );

    const result = await service.customerSegments(90);
    const byKey = Object.fromEntries(result.segments.map((row) => [row.key, row]));

    expect(result.currency).toBe('IRT');
    expect(result.metrics).toMatchObject({
      activePreviouslyPurchasedCustomers: 7,
      activeIrtPreviouslyPurchasedCustomers: 7,
      activePurchasedInWindow: 6,
      historicalDormantBuyers: 1,
      purchasesInWindow: 13,
      fulfilledRevenueRialsInWindow: 31500,
      lifetimeRepeatBuyers: 6,
      lifetimeFrequentBuyers: 3,
      topQuartileAtRiskBuyers: 1,
      activeNeverPurchasedUsers: 17,
      invalidAggregateRows: 0,
    });
    expect(byKey.frequent_active.customers).toBe(1);
    expect(byKey.frequent_at_risk.customers).toBe(1);
    expect(byKey.repeat_active.customers).toBe(1);
    expect(byKey.repeat_at_risk.customers).toBe(1);
    expect(byKey.single_purchase_window_active.customers).toBe(1);
    expect(byKey.single_purchase_window_lapsed.customers).toBe(1);
    expect(byKey.historical_dormant.customers).toBe(1);
    expect(byKey.frequent_active.monetaryTiers.M4).toMatchObject({
      customers: 1,
      revenueRials: 9000,
    });
    expect(byKey.frequent_at_risk.monetaryTiers.M4).toMatchObject({
      customers: 1,
      revenueRials: 12000,
    });
    expect(result.monetaryQuartiles).toMatchObject({
      p25: 1875,
      p50: 4000,
      p75: 8000,
    });
    expect(result.protection).toMatchObject({
      previouslyPurchasedUsersExcludedFromFirstPurchaseDiscounts: true,
      previouslyPurchasedUsersProtected: 7,
      repeatBuyersProtected: 6,
      firstPurchaseCandidatePool: 17,
      status: 'analytics_only_no_discount_is_applied',
    });

    expect(purchaseBuilder.where).toHaveBeenCalledWith(
      'e.type = :purchaseType',
      { purchaseType: expect.any(String) },
    );
    expect(purchaseBuilder.andWhere).toHaveBeenCalledWith(
      "JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.isCommercialPurchase')) = 'true'",
    );
    expect(purchaseBuilder.andWhere).toHaveBeenCalledWith(
      "JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.currency')) = 'IRT'",
    );
    expect(purchaseBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('amountRials'),
    );
    expect(purchaseBuilder.setParameter).toHaveBeenCalledWith(
      'since',
      expect.any(Date),
    );
    expect(users.count).toHaveBeenCalledWith({ where: { status: 'active' } });
    expect(neverPurchasedBuilder.leftJoin).toHaveBeenCalled();
    expect(neverPurchasedBuilder.andWhere).toHaveBeenCalledWith(
      'purchase.id IS NULL',
    );
  });

  it('rejects invalid windows rather than silently changing the cohort definition', async () => {
    const events: any = { createQueryBuilder: jest.fn() };
    const service = new RevenueAnalyticsService(
      {} as any,
      {} as any,
      {} as any,
      events,
    );

    await expect(service.customerSegments(7)).rejects.toThrow(
      'days must be an integer between 30 and 3650',
    );
    expect(events.createQueryBuilder).not.toHaveBeenCalled();
  });
});
