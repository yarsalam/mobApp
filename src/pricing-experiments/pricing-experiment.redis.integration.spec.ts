import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createHmac } from 'crypto';
import Redis from 'ioredis';
import { PricingExperimentService } from './pricing-experiment.service';

const integrationDescribe = process.env.REDIS_INTEGRATION_URL ? describe : describe.skip;
const experimentId = `pricing-budget-redis-${process.pid}-${Date.now()}`;
const signingSecret = 'redis-integration-secret-at-least-thirty-two-bytes';
const capRials = 10_000;
const discountBps = 1000;
let redis: Redis;
let service: PricingExperimentService;

const exposureEvents = new Map<string, { metadata: Record<string, unknown> }>();

function variantFor(userId: number): 'control' | 'treatment' {
  const digest = createHmac('sha256', signingSecret)
    .update(`${experimentId}:assignment:${userId}`)
    .digest();
  return digest.readUInt32BE(0) % 10_000 < 9999 ? 'treatment' : 'control';
}

function nextTreatmentUsers(count: number): number[] {
  const users: number[] = [];
  for (let id = 1; id < 20_000 && users.length < count; id += 1) {
    if (variantFor(id) === 'treatment') users.push(id);
  }
  if (users.length !== count) throw new Error('Unable to find treatment test users');
  return users;
}

function makeQueryBuilder() {
  const builder: any = {};
  for (const method of ['where', 'andWhere', 'select', 'addSelect', 'groupBy']) {
    builder[method] = () => builder;
  }
  builder.getCount = async () => 0;
  builder.getRawOne = async () => ({ spentRials: '0' });
  builder.getRawMany = async () => [];
  return builder;
}

integrationDescribe('PricingExperimentService Redis shared-budget integration', () => {
  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_INTEGRATION_URL!);
    await redis.ping();
    await redis.flushdb();

    const bundles: any = {
      findOne: async ({ where }: any) => ({
        code: where.code,
        price: 100_000,
        active: true,
      }),
    };
    const users: any = {
      findOne: async ({ where }: any) => ({
        id: where.id,
        status: 'active',
      }),
    };
    const events: any = {
      createQueryBuilder: () => makeQueryBuilder(),
      findOne: async ({ where }: any) => exposureEvents.get(where.idempotencyKey) ?? null,
    };
    const userEvents: any = {
      log: async (event: any) => {
        exposureEvents.set(event.idempotencyKey, { metadata: event.metadata });
      },
    };
    const values: Record<string, string> = {
      PRICING_EXPERIMENT_ENABLED: 'true',
      PRICING_EXPERIMENT_ID: experimentId,
      PRICING_EXPERIMENT_SECRET: signingSecret,
      PRICING_EXPERIMENT_DISCOUNT_BPS: String(discountBps),
      PRICING_EXPERIMENT_TREATMENT_RATE_BPS: '9999',
      PRICING_EXPERIMENT_ENDS_AT: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      PRICING_EXPERIMENT_MAX_DISCOUNT_BUDGET_RIALS: String(capRials),
    };
    const config: any = { get: (key: string) => values[key] };

    service = new PricingExperimentService(
      bundles,
      users,
      events,
      userEvents,
      config,
      redis,
    );
  }, 30_000);

  afterAll(async () => {
    if (redis) {
      await redis.flushdb();
      await redis.quit();
    }
  });

  it('allows only one concurrent 10000-rial discount reservation across different product types', async () => {
    const [userA, userB, userC] = nextTreatmentUsers(3);
    const [quoteA, quoteB] = await Promise.all([
      service.getQuote(userA, 'vip-bundle'),
      service.getQuote(userB, 'credits-bundle'),
    ]);

    expect(quoteA.variant).toBe('treatment');
    expect(quoteB.variant).toBe('treatment');
    expect(quoteA.discountRials).toBe(10_000);
    expect(quoteB.discountRials).toBe(10_000);

    await Promise.all([
      service.recordExposure(userA, quoteA.quoteId!),
      service.recordExposure(userB, quoteB.quoteId!),
    ]);

    const checkouts = await Promise.allSettled([
      service.prepareCheckout(userA, 'vip-bundle', quoteA.quoteId!, 'checkout-A'),
      service.prepareCheckout(userB, 'credits-bundle', quoteB.quoteId!, 'checkout-B'),
    ]);
    const accepted = checkouts.filter(
      (result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled',
    );
    const rejected = checkouts.filter(result => result.status === 'rejected');

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const acceptedIndex = checkouts.findIndex(result => result.status === 'fulfilled');
    const acceptedUser = acceptedIndex === 0 ? userA : userB;
    const acceptedKey = acceptedIndex === 0 ? 'checkout-A' : 'checkout-B';
    const acceptedCheckout = accepted[0].value;

    const [reserved, spent] = await Promise.all([
      redis.hvals(`pricing:budget:reservation-amounts:v1:${experimentId}`),
      redis.get(`pricing:budget:spent:v1:${experimentId}`),
    ]);
    expect(reserved.reduce((sum, value) => sum + Number(value), 0)).toBe(capRials);
    expect(Number(spent)).toBe(0);

    await service.commitCheckoutReservation(acceptedUser, acceptedCheckout, acceptedKey);

    expect(Number(await redis.get(`pricing:budget:spent:v1:${experimentId}`))).toBe(capRials);
    expect(await redis.hvals(`pricing:budget:reservation-amounts:v1:${experimentId}`)).toHaveLength(0);

    // Same global cap applies to every product type after the first redemption.
    const afterCap = await service.getQuote(userC, 'boost-bundle');
    expect(afterCap.eligibleForExperiment).toBe(false);
    expect(afterCap.payablePriceRials).toBe(afterCap.basePriceRials);

    const report = await service.getAdminSettings(experimentId);
    expect(report).toMatchObject({
      budgetCapRials: capRials,
      spentDiscountRials: capRials,
      reservedDiscountRials: 0,
      remainingBudgetRials: 0,
      budgetExhausted: true,
    });
  });
});
