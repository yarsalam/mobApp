import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DataSource, EntitySchema } from 'typeorm';
import Redis from 'ioredis';

import { PricingExperimentService } from './pricing-experiment.service';
import { PartitionedEvent } from '../user-event/entities/partitioned-event.entity';
import { EventType } from '../user-event/type/event-type.enum';
import { User } from '../users/entities/user.entity';

const mysqlUrl = process.env.MYSQL_INTEGRATION_URL;
const redisUrl = process.env.REDIS_INTEGRATION_URL;
const integrationDescribe = mysqlUrl && redisUrl ? describe : describe.skip;

const experimentId = `pricing-report-mysql-${process.pid}-${Date.now()}`;
const now = Date.now();

const userSchema = new EntitySchema({
  name: 'User',
  target: User,
  tableName: 'users',
  columns: {
    id: { type: Number, primary: true, generated: true },
    gender: { type: 'varchar', length: 30, nullable: true },
  },
});

const eventSchema = new EntitySchema({
  name: 'PartitionedEvent',
  target: PartitionedEvent,
  tableName: 'user_events',
  columns: {
    id: { type: Number, primary: true, generated: true },
    userId: { type: Number },
    type: { type: 'varchar', length: 100 },
    metadata: { type: 'json', nullable: true },
    idempotencyKey: { type: 'varchar', length: 128, nullable: true },
    createdAt: { type: 'timestamp', createDate: true },
  },
});

integrationDescribe('Pricing experiment report MySQL cohort integration', () => {
  let dataSource: DataSource;
  let redis: Redis;
  let service: PricingExperimentService;

  async function insertEvent(
    userId: number,
    type: EventType,
    createdAt: Date,
    metadata: Record<string, unknown>,
    idempotencyKey: string,
  ) {
    await dataSource.getRepository(PartitionedEvent).insert({
      userId,
      type,
      createdAt,
      metadata,
      idempotencyKey,
    });
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      url: mysqlUrl,
      entities: [eventSchema, userSchema],
      synchronize: true,
      dropSchema: true,
      logging: false,
    });
    await dataSource.initialize();

    redis = new Redis(redisUrl!);
    await redis.ping();

    const configValues: Record<string, string> = {
      PRICING_EXPERIMENT_ENABLED: 'false',
      PRICING_EXPERIMENT_ID: experimentId,
      PRICING_EXPERIMENT_SECRET: '',
      PRICING_EXPERIMENT_DISCOUNT_BPS: '1000',
      PRICING_EXPERIMENT_TREATMENT_RATE_BPS: '2000',
      PRICING_EXPERIMENT_MAX_DISCOUNT_BUDGET_RIALS: '200000',
      PRICING_EXPERIMENT_ENDS_AT: new Date(now + 14 * 86_400_000).toISOString(),
    };
    const config: any = { get: (key: string) => configValues[key] };

    service = new PricingExperimentService(
      {} as any,
      {} as any,
      dataSource.getRepository(PartitionedEvent),
      {} as any,
      config,
      redis,
    );
  }, 30_000);

  afterAll(async () => {
    if (redis) await redis.quit();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('joins conversions to a post-exposure purchase with the same assignment and calculates repeats', async () => {
    const t = (offsetDays: number) => new Date(now - offsetDays * 86_400_000);

    // One exposure cohort: two control users and two treatment users.
    await insertEvent(8101, EventType.PROMOTION_SHOWN, t(10), {
      promotionKind: 'pricing_experiment',
      experimentId,
      assignmentId: 'control-assignment-1',
      variant: 'control',
      payablePriceRials: 100_000,
    }, 'exposure:8101');

    // A second product view must not count this same person twice.
    await insertEvent(8101, EventType.PROMOTION_SHOWN, t(9), {
      promotionKind: 'pricing_experiment',
      experimentId,
      assignmentId: 'control-assignment-1',
      variant: 'control',
      payablePriceRials: 100_000,
    }, 'exposure:8101:second-product');

    await insertEvent(8102, EventType.PROMOTION_SHOWN, t(8), {
      promotionKind: 'pricing_experiment',
      experimentId,
      assignmentId: 'control-assignment-2',
      variant: 'control',
      payablePriceRials: 100_000,
    }, 'exposure:8102');

    await insertEvent(8201, EventType.PROMOTION_SHOWN, t(7), {
      promotionKind: 'pricing_experiment',
      experimentId,
      assignmentId: 'treatment-assignment-1',
      variant: 'treatment',
      payablePriceRials: 90_000,
    }, 'exposure:8201');

    await insertEvent(8202, EventType.PROMOTION_SHOWN, t(2), {
      promotionKind: 'pricing_experiment',
      experimentId,
      assignmentId: 'treatment-assignment-2',
      variant: 'treatment',
      payablePriceRials: 90_000,
    }, 'exposure:8202');

    const purchaseMetadata = (
      assignmentId: string,
      variant: 'control' | 'treatment',
      amountRials: number,
      basePriceRials: number,
    ) => ({
      isCommercialPurchase: true,
      currency: 'IRT',
      amountRials,
      pricingExperiment: {
        experimentId,
        assignmentId,
        variant,
        basePriceRials,
        payablePriceRials: amountRials,
        discountBps: variant === 'treatment' ? 1000 : 0,
      },
    });

    // Valid control conversion after its recorded exposure.
    await insertEvent(8101, EventType.PURCHASE, t(9.5), {
      bundleCode: 'vip-month',
      ...purchaseMetadata('control-assignment-1', 'control', 100_000, 100_000),
    }, 'purchase:8101:first');

    // This purchase predates the exposure and must not count as a conversion.
    await insertEvent(8102, EventType.PURCHASE, t(8.5), {
      bundleCode: 'vip-month',
      ...purchaseMetadata('control-assignment-2', 'control', 100_000, 100_000),
    }, 'purchase:8102:before-exposure');

    // Valid treatment conversion.
    await insertEvent(8201, EventType.PURCHASE, t(6), {
      bundleCode: 'vip-month',
      ...purchaseMetadata('treatment-assignment-1', 'treatment', 90_000, 100_000),
    }, 'purchase:8201:first');

    // Wrong assignment must not be attributed to this exposure.
    await insertEvent(8202, EventType.PURCHASE, t(1), {
      bundleCode: 'vip-month',
      ...purchaseMetadata('wrong-assignment', 'treatment', 90_000, 100_000),
    }, 'purchase:8202:wrong-assignment');

    // Purchase without any in-period exposure must not enter either cohort.
    await insertEvent(8301, EventType.PURCHASE, t(1), {
      bundleCode: 'vip-month',
      ...purchaseMetadata('no-exposure-assignment', 'treatment', 90_000, 100_000),
    }, 'purchase:8301:no-exposure');

    // Later commercial purchases belong to the original first-purchase cohort.
    await insertEvent(8101, EventType.PURCHASE, t(5), {
      bundleCode: 'credits',
      isCommercialPurchase: true,
      currency: 'IRT',
      amountRials: 50_000,
    }, 'purchase:8101:repeat');

    await insertEvent(8201, EventType.PURCHASE, t(3), {
      bundleCode: 'boost',
      isCommercialPurchase: true,
      currency: 'IRT',
      amountRials: 120_000,
    }, 'purchase:8201:repeat');

    const report = await service.getExperimentReport(experimentId, 30);
    const control = report.variants.find((row: any) => row.variant === 'control');
    const treatment = report.variants.find((row: any) => row.variant === 'treatment');

    expect(control).toMatchObject({
      exposedUsers: 2,
      purchasedUsers: 1,
      conversionRatePercent: 50,
      revenueRials: 100_000,
      discountRials: 0,
      repeatPurchasedUsers: 1,
      repeatPurchaseCount: 1,
      repeatRevenueRials: 50_000,
      totalObservedRevenueRials: 150_000,
      observedRevenuePerExposedUserRials: 75_000,
    });

    expect(treatment).toMatchObject({
      exposedUsers: 2,
      purchasedUsers: 1,
      conversionRatePercent: 50,
      revenueRials: 90_000,
      discountRials: 10_000,
      repeatPurchasedUsers: 1,
      repeatPurchaseCount: 1,
      repeatRevenueRials: 120_000,
      totalObservedRevenueRials: 210_000,
      observedRevenuePerExposedUserRials: 105_000,
    });

    // The immutable purchase ledger records all committed discounts, even
    // if a synthetic malformed purchase is deliberately excluded from cohort
    // attribution above.
    expect(report.budget).toMatchObject({
      budgetCapRials: 200_000,
      spentDiscountRials: 30_000,
    });
    expect(report.interpretation).toContain('matching exposure');
    expect(report.interpretation).toContain('descriptive_only');
  }, 30_000);
});
