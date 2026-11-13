import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PricingExperimentService } from './pricing-experiment.service';
import { EventType } from '../user-event/type/event-type.enum';

const EXPERIMENT_ID = 'pricing-first-purchase-v1';
const SECRET = 'test-only-secret-that-is-longer-than-32-characters';

function bucketFor(userId: number, treatmentRateBps = 5000) {
  const digest = createHmac('sha256', SECRET)
    .update(`${EXPERIMENT_ID}:assignment:${userId}`)
    .digest();
  return digest.readUInt32BE(0) % 10000 < treatmentRateBps
    ? 'treatment'
    : 'control';
}

function makeBuilder(rawRows: any[] = [], count = 0) {
  const builder: any = {};
  for (const method of ['where', 'andWhere', 'select', 'addSelect', 'groupBy']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.getCount = jest.fn(async () => count);
  builder.getRawMany = jest.fn(async () => rawRows);
  return builder;
}

function makeService(options?: {
  enabled?: string;
  discountBps?: string;
  treatmentRateBps?: string;
  hasPriorPurchase?: boolean;
  redisSet?: any;
  redisGet?: any;
  exposure?: any;
}) {
  const bundleRepo: any = {
    findOne: jest.fn(async () => ({
      code: 'vip-month',
      price: 100_000,
      active: true,
    })),
  };
  const userRepo: any = {
    findOne: jest.fn(async () => ({ id: 7, status: 'active' })),
  };
  const eligibilityBuilder = makeBuilder([], options?.hasPriorPurchase ? 1 : 0);
  const eventRepo: any = {
    createQueryBuilder: jest.fn(() => eligibilityBuilder),
    findOne: jest.fn(async () => options?.exposure ?? null),
  };
  const userEvents: any = {
    log: jest.fn(async () => undefined),
  };
  const configValues: Record<string, string> = {
    PRICING_EXPERIMENT_ENABLED: options?.enabled ?? 'true',
    PRICING_EXPERIMENT_ID: EXPERIMENT_ID,
    PRICING_EXPERIMENT_SECRET: SECRET,
    PRICING_EXPERIMENT_DISCOUNT_BPS: options?.discountBps ?? '1000',
    PRICING_EXPERIMENT_TREATMENT_RATE_BPS:
      options?.treatmentRateBps ?? '5000',
  };
  const config: any = {
    get: jest.fn((key: string) => configValues[key]),
  };
  const redis: any = {
    set: jest.fn(options?.redisSet ?? (async () => 'OK')),
    get: jest.fn(options?.redisGet ?? (async () => null)),
    eval: jest.fn(async () => 1),
  };
  const service = new PricingExperimentService(
    bundleRepo,
    userRepo,
    eventRepo,
    userEvents,
    config,
    redis,
  );
  return {
    service,
    bundleRepo,
    userRepo,
    eventRepo,
    eligibilityBuilder,
    userEvents,
    redis,
    config,
  };
}

async function findUserForVariant(variant: 'control' | 'treatment') {
  for (let userId = 1; userId <= 500; userId++) {
    if (bucketFor(userId) === variant) return userId;
  }
  throw new Error(`Could not find ${variant} user fixture`);
}

function decodeQuote(quoteId: string) {
  const [payload] = quoteId.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

describe('PricingExperimentService', () => {
  it('keeps the experiment disabled by default and returns only the catalogue price', async () => {
    const h = makeService({ enabled: 'false' });

    const quote = await h.service.getQuote(7, 'vip-month');

    expect(quote).toMatchObject({
      basePriceRials: 100_000,
      payablePriceRials: 100_000,
      discountRials: 0,
      eligibleForExperiment: false,
      quoteId: null,
      variant: null,
    });
    expect(h.eventRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('assigns a first-time purchaser deterministically to a signed treatment quote', async () => {
    const userId = await findUserForVariant('treatment');
    const h = makeService();

    const first = await h.service.getQuote(userId, 'vip-month');
    const second = await h.service.getQuote(userId, 'vip-month');

    expect(first).toMatchObject({
      variant: 'treatment',
      eligibleForExperiment: true,
      basePriceRials: 100_000,
      payablePriceRials: 90_000,
      discountRials: 10_000,
      discountBps: 1000,
    });
    expect(first.quoteId).toBeTruthy();
    expect(second.variant).toBe(first.variant);
    expect(second.quoteId).toBeTruthy();
    expect(decodeQuote(first.quoteId!).assignmentId).toBe(
      decodeQuote(second.quoteId!).assignmentId,
    );
    expect(h.userRepo.findOne).toHaveBeenCalledWith({
      where: { id: userId },
      select: ['id', 'status'],
    });
  });

  it('keeps control-arm prices unchanged while still signing an experiment quote', async () => {
    const userId = await findUserForVariant('control');
    const h = makeService();

    const quote = await h.service.getQuote(userId, 'vip-month');

    expect(quote).toMatchObject({
      variant: 'control',
      eligibleForExperiment: true,
      basePriceRials: 100_000,
      payablePriceRials: 100_000,
      discountRials: 0,
      discountBps: 0,
    });
    expect(quote.quoteId).toBeTruthy();
  });

  it('excludes any customer with a prior fulfilled commercial purchase', async () => {
    const h = makeService({ hasPriorPurchase: true });

    const quote = await h.service.getQuote(7, 'vip-month');

    expect(quote.eligibleForExperiment).toBe(false);
    expect(quote.quoteId).toBeNull();
    expect(quote.payablePriceRials).toBe(100_000);
    expect(h.eligibilityBuilder.getCount).toHaveBeenCalled();
  });

  it('rejects enabled experiments whose secret or assignment settings are missing', async () => {
    const h = makeService();
    h.config.get.mockImplementation((key: string) => {
      if (key === 'PRICING_EXPERIMENT_SECRET') return 'short';
      return {
        PRICING_EXPERIMENT_ENABLED: 'true',
        PRICING_EXPERIMENT_ID: EXPERIMENT_ID,
        PRICING_EXPERIMENT_DISCOUNT_BPS: '1000',
        PRICING_EXPERIMENT_TREATMENT_RATE_BPS: '5000',
      }[key];
    });

    await expect(h.service.getQuote(7, 'vip-month')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('records a real price exposure idempotently with the exact assigned price', async () => {
    const userId = await findUserForVariant('treatment');
    const h = makeService();
    const quote = await h.service.getQuote(userId, 'vip-month');

    const result = await h.service.recordExposure(userId, quote.quoteId!);

    expect(result).toMatchObject({
      success: true,
      experimentId: EXPERIMENT_ID,
      variant: 'treatment',
    });
    expect(h.userEvents.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        type: EventType.PROMOTION_SHOWN,
        metadata: expect.objectContaining({
          promotionKind: 'pricing_experiment',
          experimentId: EXPERIMENT_ID,
          variant: 'treatment',
          bundleCode: 'vip-month',
          basePriceRials: 100_000,
          payablePriceRials: 90_000,
          discountRials: 10_000,
        }),
        idempotencyKey: expect.stringMatching(/^pricing-exposure:/),
      }),
    );
  });

  it('requires the exposure receipt before accepting a quote at checkout', async () => {
    const h = makeService();
    const quote = await h.service.getQuote(7, 'vip-month');

    await expect(
      h.service.prepareCheckout(7, 'vip-month', quote.quoteId!, 'checkout-1'),
    ).rejects.toThrow('Pricing quote must be exposed before checkout');
  });

  it('rejects tampered quote signatures before checkout', async () => {
    const h = makeService();
    const quote = await h.service.getQuote(7, 'vip-month');
    const tampered = quote.quoteId!.slice(0, -1) + 'A';

    await expect(
      h.service.prepareCheckout(7, 'vip-month', tampered, 'checkout-1'),
    ).rejects.toThrow('pricing quote signature');
  });

  it('reserves a treatment offer for one idempotency key and blocks another checkout', async () => {
    const userId = await findUserForVariant('treatment');
    const h = makeService({
      exposure: {
        metadata: {
          promotionKind: 'pricing_experiment',
          experimentId: EXPERIMENT_ID,
          assignmentId: 'px_fixture',
          variant: 'treatment',
          payablePriceRials: 90_000,
        },
      },
    });
    const quote = await h.service.getQuote(userId, 'vip-month');
    const payload = decodeQuote(quote.quoteId!);
    h.eventRepo.findOne.mockResolvedValue({
      metadata: {
        promotionKind: 'pricing_experiment',
        experimentId: EXPERIMENT_ID,
        assignmentId: payload.assignmentId,
        variant: 'treatment',
        payablePriceRials: 90_000,
      },
    });
    h.redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    h.redis.get.mockResolvedValueOnce('checkout-A').mockResolvedValueOnce('checkout-A');

    const checkout = await h.service.prepareCheckout(
      userId,
      'vip-month',
      quote.quoteId!,
      'checkout-A',
    );
    expect(checkout).toMatchObject({
      variant: 'treatment',
      payablePriceRials: 90_000,
      basePriceRials: 100_000,
    });

    await expect(
      h.service.prepareCheckout(
        userId,
        'vip-month',
        quote.quoteId!,
        'checkout-B',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows retry with the same idempotency key and releases only its own reservation', async () => {
    const userId = await findUserForVariant('treatment');
    const h = makeService();
    const quote = await h.service.getQuote(userId, 'vip-month');
    const payload = decodeQuote(quote.quoteId!);
    h.eventRepo.findOne.mockResolvedValue({
      metadata: {
        promotionKind: 'pricing_experiment',
        experimentId: EXPERIMENT_ID,
        assignmentId: payload.assignmentId,
        variant: 'treatment',
        payablePriceRials: 90_000,
      },
    });
    h.redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    h.redis.get.mockResolvedValueOnce('checkout-A');

    await h.service.prepareCheckout(userId, 'vip-month', quote.quoteId!, 'checkout-A');
    await expect(
      h.service.prepareCheckout(userId, 'vip-month', quote.quoteId!, 'checkout-A'),
    ).resolves.toMatchObject({ payablePriceRials: 90_000 });

    await h.service.releaseTreatmentReservation(userId, EXPERIMENT_ID, 'checkout-A');
    expect(h.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET'"),
      1,
      `pricing:redeemed:${EXPERIMENT_ID}:${userId}`,
      'checkout-A',
    );
  });

  it('rejects a quote after the user purchases in the meantime', async () => {
    const h = makeService();
    const quote = await h.service.getQuote(7, 'vip-month');
    const payload = decodeQuote(quote.quoteId!);
    h.eventRepo.findOne.mockResolvedValue({
      metadata: {
        promotionKind: 'pricing_experiment',
        experimentId: EXPERIMENT_ID,
        assignmentId: payload.assignmentId,
        variant: payload.variant,
        payablePriceRials: payload.payablePriceRials,
      },
    });
    h.eligibilityBuilder.getCount.mockResolvedValue(1);

    await expect(
      h.service.prepareCheckout(7, 'vip-month', quote.quoteId!, 'checkout-A'),
    ).rejects.toThrow('First-purchase pricing is no longer available');
  });

  it('reports exposure and purchase conversion separately for control and treatment', async () => {
    const exposures = makeBuilder([
      { variant: 'control', exposedUsers: '12' },
      { variant: 'treatment', exposedUsers: '10' },
    ]);
    const purchases = makeBuilder([
      { variant: 'control', purchasedUsers: '2', revenueRials: '200000', discountRials: '0' },
      { variant: 'treatment', purchasedUsers: '3', revenueRials: '270000', discountRials: '30000' },
    ]);
    const h = makeService();
    h.eventRepo.createQueryBuilder
      .mockReturnValueOnce(exposures)
      .mockReturnValueOnce(purchases);

    const report = await h.service.getExperimentReport(EXPERIMENT_ID, 30);

    expect(report.variants).toEqual([
      {
        variant: 'control',
        exposedUsers: 12,
        purchasedUsers: 2,
        conversionRatePercent: 16.67,
        revenueRials: 200_000,
        discountRials: 0,
      },
      {
        variant: 'treatment',
        exposedUsers: 10,
        purchasedUsers: 3,
        conversionRatePercent: 30,
        revenueRials: 270_000,
        discountRials: 30_000,
      },
    ]);
    expect(report.interpretation).toContain('descriptive_only');
  });
});
