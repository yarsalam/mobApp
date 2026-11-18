import { describe, expect, it, jest } from '@jest/globals';
import { PromotionExposureService } from './promotion-exposure.service';

function makeService(redis: any) {
  const config: any = { get: jest.fn(() => undefined) };
  return new PromotionExposureService(
    redis,
    {} as any,
    {} as any,
    {} as any,
    config,
    {} as any,
  );
}

describe('PromotionExposureService fail-closed limits', () => {
  it('allows a first exposure when no daily, cooldown or block keys exist', async () => {
    const redis = { get: jest.fn(async () => null) };
    const service = makeService(redis);
    await expect(service.canShow(42, 'manual_discount')).resolves.toBe(true);
    expect(redis.get).toHaveBeenCalledTimes(3);
  });

  it('enforces the manual-discount daily cap', async () => {
    const redis = { get: jest.fn(async (key: string) => key.includes(':promo:daily:') ? '2' : null) };
    // Keys are namespaced by promo:daily rather than a fixed prefix.
    redis.get.mockImplementation(async (key: string) =>
      key.startsWith('promo:daily:') ? '2' : null,
    );
    const service = makeService(redis);
    await expect(service.canShow(42, 'manual_discount')).resolves.toBe(false);
  });

  it('records a promotion impression only after all exposure counters persist', async () => {
    const redis = {
      get: jest.fn(async () => null),
      incr: jest.fn(async () => 1),
      expire: jest.fn(async () => 1),
      set: jest.fn(async () => 'OK'),
    };
    const service = makeService(redis);
    await expect(service.trackImpression(42, 'manual_discount')).resolves.toBe(true);
    expect(redis.incr).toHaveBeenCalledTimes(1);
    expect(redis.expire).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it('does not allow a promotion to display when the impression ledger write fails', async () => {
    const redis = {
      get: jest.fn(async () => null),
      incr: jest.fn(async () => { throw new Error('redis unavailable'); }),
      expire: jest.fn(async () => 1),
      set: jest.fn(async () => 'OK'),
    };
    const service = makeService(redis);
    await expect(service.trackImpression(42, 'boost')).resolves.toBe(false);
  });

  it('fails closed if Redis cannot confirm whether an exposure is allowed', async () => {
    const redis = { get: jest.fn(async () => { throw new Error('redis unavailable'); }) };
    const service = makeService(redis);
    await expect(service.canShow(42, 'manual_discount')).resolves.toBe(false);
  });
});
