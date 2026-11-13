import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { UserMetricsService } from './user-metrics.service';

describe('UserMetricsService lifecycle metrics', () => {
  afterEach(() => jest.restoreAllMocks());

  it('calculates signup and latest paid-purchase age from persisted timestamps', async () => {
    const now = new Date('2026-11-13T00:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const userRepo = {
      findOne: jest.fn(async () => ({ createdAt: new Date(now - 10 * 86400000) })),
    };
    const paymentRepo = {
      count: jest.fn(async () => 2),
      findOne: jest.fn(async () => ({
        confirmedAt: new Date(now - 45 * 86400000),
        createdAt: new Date(now - 46 * 86400000),
      })),
    };
    const service = new UserMetricsService(
      { count: jest.fn(async () => 0) } as any,
      paymentRepo as any,
      { count: jest.fn(async () => 0) } as any,
      { query: jest.fn(async () => [{ retention_count: 0 }]) } as any,
      userRepo as any,
    );

    const metrics = await service.buildExtraMetrics(42);
    expect(metrics.daysSinceSignup).toBe(10);
    expect(metrics.lastPurchaseDays).toBe(45);
    expect(metrics.pastPayments).toBe(2);
  });

  it('returns null when there is no confirmed paid transaction', async () => {
    const now = new Date('2026-11-13T00:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const service = new UserMetricsService(
      { count: jest.fn(async () => 0) } as any,
      { count: jest.fn(async () => 0), findOne: jest.fn(async () => null) } as any,
      { count: jest.fn(async () => 0) } as any,
      { query: jest.fn(async () => [{ retention_count: 0 }]) } as any,
      { findOne: jest.fn(async () => ({ createdAt: new Date(now - 5 * 86400000) })) } as any,
    );

    const metrics = await service.buildExtraMetrics(42);
    expect(metrics.daysSinceSignup).toBe(5);
    expect(metrics.lastPurchaseDays).toBeNull();
  });
});
