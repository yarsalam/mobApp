import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource, EntitySchema } from 'typeorm';
import { ManualPromotionService } from './manual-promotion.service';
import { ManualPromotionCampaign } from './entities/manual-promotion-campaign.entity';
import { ManualPromotionRedemption } from './entities/manual-promotion-redemption.entity';
import { ProductBundle } from '../product/entities/product-bundle.entity';
import { UserWallet } from '../payments/wallet/entities/user-wallet.entity';
import { WalletService } from '../payments/wallet/wallet.service';
import { PartitionedEvent } from '../user-event/entities/partitioned-event.entity';
import { EventType } from '../user-event/type/event-type.enum';
import { User } from '../users/entities/user.entity';

const mysqlUrl = process.env.MYSQL_INTEGRATION_URL;
const mysqlDescribe = mysqlUrl ? describe : describe.skip;

const campaignSchema = new EntitySchema<ManualPromotionCampaign>({
  name: 'ManualPromotionCampaign',
  target: ManualPromotionCampaign,
  tableName: 'manual_promotion_campaigns',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    name: { type: 'varchar', length: 120 },
    title: { type: 'varchar', length: 120 },
    subtitle: { type: 'varchar', length: 280 },
    ctaText: { type: 'varchar', length: 60, default: 'مشاهده پیشنهاد' },
    bundleCode: { type: 'varchar', length: 255 },
    discountType: { type: 'enum', enum: ['percent', 'fixed'] },
    discountValue: { type: 'int', unsigned: true },
    audienceType: { type: 'enum', enum: ['all', 'users', 'phases'] },
    audienceUserIds: { type: 'json', nullable: true },
    audiencePhases: { type: 'json', nullable: true },
    startsAt: { type: 'datetime' },
    endsAt: { type: 'datetime' },
    maxRedemptions: { type: 'int', unsigned: true, nullable: true },
    perUserLimit: { type: 'int', unsigned: true, default: 1 },
    priority: { type: 'int', default: 0 },
    active: { type: 'boolean', default: false },
    createdAt: { type: 'datetime', createDate: true },
    updatedAt: { type: 'datetime', updateDate: true },
  },
});

const redemptionSchema = new EntitySchema<ManualPromotionRedemption>({
  name: 'ManualPromotionRedemption',
  target: ManualPromotionRedemption,
  tableName: 'manual_promotion_redemptions',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    campaignId: { type: 'char', length: 36 },
    userId: { type: 'int', unsigned: true },
    bundleCode: { type: 'varchar', length: 255 },
    checkoutKey: { type: 'varchar', length: 80 },
    basePriceRials: { type: 'int', unsigned: true },
    discountRials: { type: 'int', unsigned: true },
    payablePriceRials: { type: 'int', unsigned: true },
    status: { type: 'enum', enum: ['reserved', 'redeemed', 'released'], default: 'reserved' },
    createdAt: { type: 'datetime', createDate: true },
    redeemedAt: { type: 'datetime', nullable: true },
  },
  indices: [
    { name: 'UQ_manual_promotion_checkout', unique: true, columns: ['campaignId', 'userId', 'checkoutKey'] },
    { name: 'IDX_manual_promotion_campaign_status', columns: ['campaignId', 'status'] },
    { name: 'IDX_manual_promotion_user_status', columns: ['campaignId', 'userId', 'status'] },
  ],
});

const bundleSchema = new EntitySchema<ProductBundle>({
  name: 'ProductBundle',
  target: ProductBundle,
  tableName: 'product_bundles',
  columns: {
    id: { type: Number, primary: true, generated: true },
    code: { type: 'varchar', length: 255, unique: true },
    items: { type: 'json' },
    price: { type: 'int' },
    active: { type: 'boolean', default: true },
  },
});

const walletSchema = new EntitySchema<UserWallet>({
  name: 'UserWallet',
  target: UserWallet,
  tableName: 'user_wallets',
  columns: {
    id: { type: Number, primary: true, generated: true },
    userId: { type: Number, unique: true },
    balance: { type: 'bigint', default: 0 },
    currency: { type: 'varchar', length: 5, default: 'IRT' },
  },
});

const eventSchema = new EntitySchema<PartitionedEvent>({
  name: 'PartitionedEvent',
  target: PartitionedEvent,
  tableName: 'user_events',
  columns: {
    id: { type: Number, primary: true, generated: true },
    userId: { type: Number },
    type: { type: 'varchar', length: 100 },
    metadata: { type: 'json', nullable: true },
    idempotencyKey: { type: 'varchar', length: 128, nullable: true },
    createdAt: { type: 'datetime', createDate: true },
  },
  uniques: [{
    name: 'UQ_manual_wallet_event_idempotency',
    columns: ['userId', 'idempotencyKey'],
  }],
});

const userSchema = new EntitySchema<User>({
  name: 'User',
  target: User,
  tableName: 'user',
  columns: {
    id: { type: Number, primary: true },
    status: { type: 'varchar', length: 30 },
    gender: { type: 'varchar', length: 30, nullable: true },
  },
});

mysqlDescribe('Manual promotion MySQL reservation integration', () => {
  let dataSource: DataSource;
  let service: ManualPromotionService;
  let walletService: WalletService;
  const campaignId = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      url: mysqlUrl,
      entities: [
        campaignSchema,
        redemptionSchema,
        bundleSchema,
        userSchema,
        walletSchema,
        eventSchema,
      ],
      synchronize: true,
      dropSchema: true,
      logging: false,
    });
    await dataSource.initialize();
    const phases: any = { get: async () => ({ phase: 'warm' }) };
    service = new ManualPromotionService(
      dataSource.getRepository(ManualPromotionCampaign),
      dataSource.getRepository(ManualPromotionRedemption),
      dataSource.getRepository(ProductBundle),
      dataSource.getRepository(User),
      phases,
      dataSource,
    );
    const eventService = {
      logWithManager: async (manager: any, event: any) => {
        await manager.getRepository(PartitionedEvent).insert({
          userId: event.userId,
          type: event.type,
          metadata: event.metadata,
          idempotencyKey: event.idempotencyKey ?? null,
        });
        return true;
      },
    };
    walletService = new WalletService(
      dataSource.getRepository(UserWallet),
      eventService as any,
      dataSource,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.getRepository(ManualPromotionRedemption).clear();
    await dataSource.getRepository(ManualPromotionCampaign).clear();
    await dataSource.getRepository(PartitionedEvent).clear();
    await dataSource.getRepository(UserWallet).clear();
    await dataSource.getRepository(ProductBundle).clear();
    await dataSource.getRepository(User).clear();

    await dataSource.getRepository(ProductBundle).save({
      code: 'vip-month',
      items: [{ type: 'vip', amount: 30, durationDays: 30 }],
      price: 100_000,
      active: true,
    });
    await dataSource.getRepository(User).save([
      { id: 9101, status: 'active', gender: 'men' },
      { id: 9102, status: 'active', gender: 'women' },
      { id: 9103, status: 'active', gender: 'men' },
    ]);
    await dataSource.getRepository(ManualPromotionCampaign).save({
      id: campaignId,
      name: 'Concurrent test',
      title: 'Test offer',
      subtitle: 'Limited offer',
      ctaText: 'Buy',
      bundleCode: 'vip-month',
      discountType: 'percent',
      discountValue: 20,
      audienceType: 'all',
      audienceUserIds: null,
      audiencePhases: null,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60 * 60_000),
      maxRedemptions: 1,
      perUserLimit: 1,
      priority: 1,
      active: true,
    });
  });

  it('enforces one global redemption under simultaneous checkouts and replays one key idempotently', async () => {
    const attempts = await Promise.allSettled([
      service.reserveForCheckout(9101, campaignId, 'vip-month', 'checkout-user-9101'),
      service.reserveForCheckout(9102, campaignId, 'vip-month', 'checkout-user-9102'),
    ]);
    const accepted = attempts.filter((item) => item.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = attempts.filter((item) => item.status === 'rejected');
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const acceptedIndex = attempts.findIndex((item) => item.status === 'fulfilled');
    const acceptedUserId = acceptedIndex === 0 ? 9101 : 9102;
    const checkoutKey = `checkout-user-${acceptedUserId}`;
    const first = accepted[0].value;
    const replay = await service.reserveForCheckout(
      acceptedUserId,
      campaignId,
      'vip-month',
      checkoutKey,
    );
    expect(replay.redemptionId).toBe(first.redemptionId);
    expect(replay.payablePriceRials).toBe(80_000);

    await service.markRedeemed(campaignId, first.redemptionId, acceptedUserId);
    await expect(
      service.reserveForCheckout(9103, campaignId, 'vip-month', 'checkout-user-9103'),
    ).rejects.toThrow('Promotion redemption limit has been reached');

    expect(await dataSource.getRepository(ManualPromotionRedemption).count({
      where: { campaignId, status: 'redeemed' },
    })).toBe(1);
  });

  it('charges the discounted wallet price once, redeems once, and records the realized discount', async () => {
    const userId = 9101;
    const checkoutKey = 'manual-e2e-checkout-9101';
    const debitKey = `wallet-checkout:${checkoutKey}:debit`;

    await walletService.creditOnce(userId, 100_000, 'staging-test-seed', 'manual-e2e-seed-9101');

    const quote = await service.getQuote(userId, campaignId, 'vip-month');
    expect(quote).toMatchObject({
      basePriceRials: 100_000,
      discountRials: 20_000,
      payablePriceRials: 80_000,
    });

    const reservation = await service.reserveForCheckout(
      userId,
      campaignId,
      'vip-month',
      checkoutKey,
    );
    expect(reservation).toMatchObject({
      basePriceRials: 100_000,
      discountRials: 20_000,
      payablePriceRials: 80_000,
    });

    await walletService.debitOnce(
      userId,
      reservation.payablePriceRials,
      'buy:vip-month',
      debitKey,
    );
    await service.markRedeemed(campaignId, reservation.redemptionId, userId);

    // Retry after an ambiguous client timeout: the reservation and wallet
    // receipt must both replay without charging a second time.
    const replayReservation = await service.reserveForCheckout(
      userId,
      campaignId,
      'vip-month',
      checkoutKey,
    );
    await walletService.debitOnce(
      userId,
      replayReservation.payablePriceRials,
      'buy:vip-month',
      debitKey,
    );
    await service.markRedeemed(campaignId, reservation.redemptionId, userId);

    const wallet = await dataSource.getRepository(UserWallet).findOneByOrFail({ userId });
    const debitReceipts = await dataSource.getRepository(PartitionedEvent).count({
      where: { userId, type: EventType.CREDITS_SPENT, idempotencyKey: debitKey },
    });
    const report = await service.getCampaignReport(campaignId);

    expect(Number(wallet.balance)).toBe(20_000);
    expect(debitReceipts).toBe(1);
    expect(report).toMatchObject({
      reserved: 0,
      redeemed: 1,
      released: 0,
      discountRials: 20_000,
      active: true,
    });
  });

  it('releases a reservation after a definitive insufficient-balance result so the next eligible buyer can use the cap', async () => {
    const reservation = await service.reserveForCheckout(
      9101,
      campaignId,
      'vip-month',
      'checkout-insufficient',
    );
    await service.releaseReservation(campaignId, reservation.redemptionId, 9101);

    const next = await service.reserveForCheckout(
      9102,
      campaignId,
      'vip-month',
      'checkout-next',
    );
    expect(next.payablePriceRials).toBe(80_000);
    expect(await dataSource.getRepository(ManualPromotionRedemption).count({
      where: { campaignId, status: 'reserved' },
    })).toBe(1);
  });
});
