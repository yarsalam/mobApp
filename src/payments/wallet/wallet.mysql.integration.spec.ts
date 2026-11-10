import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource, EntitySchema } from 'typeorm';
import { WalletService } from './wallet.service';
import { UserWallet } from './entities/user-wallet.entity';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { EventType } from 'src/user-event/type/event-type.enum';
import { Payment } from 'src/payments/entities/payment.entity';
import { CryptoWatcherProcessor } from './verification/crypto-watcher.processor';
import { of } from 'rxjs';
import { createHash } from 'crypto';
import { User } from 'src/users/entities/user.entity';
import { UserCredits } from 'src/payments/credits/entities/user-credits.entity';
import { UserBoost } from 'src/payments/boosts/entities/user-boost.entity';
import { UserVip } from 'src/payments/vip/entities/vip.entity';
import { PaymentsService } from 'src/payments/payments.service';
import { CreditsService } from 'src/payments/credits/credits.service';
import { BoostService } from 'src/payments/boosts/boosts.service';
import { VipService } from 'src/payments/vip/vip.service';

const mysqlUrl = process.env.MYSQL_INTEGRATION_URL;
const mysqlDescribe = mysqlUrl ? describe : describe.skip;

const walletSchema = new EntitySchema({
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

const userSchema = new EntitySchema({
  name: 'User',
  target: User,
  tableName: 'users',
  columns: {
    id: { type: Number, primary: true, generated: true },
    gender: { type: 'varchar', length: 30, nullable: true },
  },
});

const creditsSchema = new EntitySchema({
  name: 'UserCredits',
  target: UserCredits,
  tableName: 'user_credits',
  columns: {
    id: { type: Number, primary: true, generated: true },
    userId: { type: Number, unique: true },
    balance: { type: 'int', default: 0 },
    updatedAt: { type: 'timestamp', updateDate: true },
  },
});

const boostSchema = new EntitySchema<any>({
  name: 'UserBoost',
  target: UserBoost,
  tableName: 'user_boosts',
  columns: {
    id: { type: Number, primary: true, generated: true },
    instantCount: { type: 'int', default: 0 },
    monthlyUntil: { type: 'timestamp', nullable: true },
    activeUntil: { type: 'timestamp', nullable: true },
    strength: { type: 'int', default: 1 },
    freeGranted: { type: 'boolean', default: false },
    expiresAt: { type: 'timestamp', nullable: true },
    createdAt: { type: 'timestamp', createDate: true },
    updatedAt: { type: 'timestamp', updateDate: true },
  },
  relations: {
    user: {
      type: 'one-to-one',
      target: 'User',
      joinColumn: { name: 'userId', referencedColumnName: 'id' },
    },
  },
});

const vipSchema = new EntitySchema({
  name: 'UserVip',
  target: UserVip,
  tableName: 'user_vips',
  columns: {
    id: { type: Number, primary: true, generated: true },
    userId: { type: Number },
    active: { type: 'boolean', default: true },
    expiresAt: { type: 'timestamp' },
  },
  indices: [{ columns: ['userId', 'active'] }],
});

const paymentSchema = new EntitySchema({
  name: 'Payment',
  target: Payment,
  tableName: 'payments',
  columns: {
    id: { type: Number, primary: true, generated: true },
    userId: { type: Number },
    productCode: { type: 'varchar', length: 100 },
    amount: { type: 'bigint' },
    currency: { type: 'varchar', length: 10 },
    method: { type: 'varchar', length: 20 },
    status: { type: 'varchar', length: 20 },
    walletAddress: { type: 'varchar', length: 255, nullable: true },
    txHash: { type: 'varchar', length: 255, nullable: true, unique: true },
    confirmedAt: { type: 'timestamp', nullable: true },
    expiresAt: { type: 'timestamp', nullable: true },
    metadata: { type: 'json', nullable: true },
    createdAt: { type: 'timestamp', createDate: true },
    updatedAt: { type: 'timestamp', updateDate: true },
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
  },
  uniques: [
    {
      name: 'uq_wallet_integration_user_idempotency',
      columns: ['userId', 'idempotencyKey'],
    },
  ],
});

mysqlDescribe('WalletService MySQL transaction integration', () => {
  let dataSource: DataSource;

  function makeEventService(fail = false) {
    return {
      logWithManager: async (manager: any, event: any) => {
        if (fail) throw new Error('injected event-write failure');
        const repository = manager.getRepository(PartitionedEvent);
        await repository.insert({
          userId: event.userId,
          type: event.type,
          metadata: event.metadata,
          idempotencyKey: event.idempotencyKey,
        });
        return true;
      },
    };
  }

  function makeWalletService(failEventWrite = false) {
    return new WalletService(
      dataSource.getRepository(UserWallet),
      makeEventService(failEventWrite) as any,
      dataSource,
    );
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      url: mysqlUrl,
      entities: [walletSchema, eventSchema, paymentSchema, userSchema, creditsSchema, boostSchema, vipSchema],
      synchronize: true,
      dropSchema: true,
      logging: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.getRepository(Payment).clear();
    await dataSource.getRepository(PartitionedEvent).clear();
    await dataSource.getRepository(UserWallet).clear();
    await dataSource.getRepository(UserCredits).clear();
    await dataSource.getRepository(UserBoost).clear();
    await dataSource.getRepository(UserVip).clear();
    // Keep the referenced user row: MySQL rejects TRUNCATE on a parent table
    // while child tables have foreign-key constraints, even when they are empty.
  });

  it('applies only one credit when two concurrent workers use the same receipt key', async () => {
    const service = makeWalletService();

    await Promise.all([
      service.creditOnce(7001, 500, 'payment:9001', 'payment:9001:wallet-credit'),
      service.creditOnce(7001, 500, 'payment:9001', 'payment:9001:wallet-credit'),
    ]);

    const wallet = await dataSource.getRepository(UserWallet).findOneByOrFail({ userId: 7001 });
    const receipts = await dataSource.getRepository(PartitionedEvent).count({
      where: { userId: 7001, idempotencyKey: 'payment:9001:wallet-credit' },
    });

    expect(Number(wallet.balance)).toBe(500);
    expect(receipts).toBe(1);
  });

  it('rolls back the balance mutation when the durable receipt write fails, then permits a safe retry', async () => {
    const failingService = makeWalletService(true);

    await expect(
      failingService.creditOnce(7002, 600, 'payment:9002', 'payment:9002:wallet-credit'),
    ).rejects.toThrow('injected event-write failure');

    expect(await dataSource.getRepository(UserWallet).count()).toBe(0);
    expect(await dataSource.getRepository(PartitionedEvent).count()).toBe(0);

    await makeWalletService().creditOnce(
      7002,
      600,
      'payment:9002',
      'payment:9002:wallet-credit',
    );

    const wallet = await dataSource.getRepository(UserWallet).findOneByOrFail({ userId: 7002 });
    expect(Number(wallet.balance)).toBe(600);
    expect(
      await dataSource.getRepository(PartitionedEvent).count({
        where: { userId: 7002, type: EventType.CREDITS_GRANTED },
      }),
    ).toBe(1);
  });

  it('atomically settles a TRC20 payment once when two real MySQL workers race', async () => {
    const previousMockSetting = process.env.CRYPTO_WATCHER_MOCK;
    process.env.CRYPTO_WATCHER_MOCK = 'false';

    try {
      const now = Date.now();
      const paymentRepo = dataSource.getRepository(Payment);
      const payment = await paymentRepo.save(paymentRepo.create({
        userId: 7101,
        productCode: 'wallet_charge',
        amount: 500,
        currency: 'USDT',
        method: 'crypto_usdt',
        status: 'pending',
        walletAddress: 'TWalletConcurrent',
        createdAt: new Date(now - 60_000),
        expiresAt: new Date(now + 30 * 60_000),
      }));

      let networkCalls = 0;
      const httpService: any = {
        get: () => {
          networkCalls += 1;
          return of({
            data: {
              data: [{
                transaction_id: 'mysql-concurrent-trc20-tx',
                value: '5000000',
                block_timestamp: now,
                to: 'TWalletConcurrent',
              }],
            },
          });
        },
      };
      const processor = new CryptoWatcherProcessor(
        paymentRepo,
        {} as any,
        makeWalletService(),
        httpService,
      );
      const job: any = { name: 'check-payment', data: { paymentId: payment.id } };

      await Promise.all([processor.process(job), processor.process(job)]);

      const settled = await paymentRepo.findOneByOrFail({ id: payment.id });
      const wallet = await dataSource.getRepository(UserWallet).findOneByOrFail({ userId: 7101 });
      const receipts = await dataSource.getRepository(PartitionedEvent).count({
        where: {
          userId: 7101,
          idempotencyKey: `payment:${payment.id}:wallet-credit`,
        },
      });

      expect(settled.status).toBe('paid');
      expect(settled.txHash).toBe('mysql-concurrent-trc20-tx');
      expect(Number(wallet.balance)).toBe(4_500_000);
      expect(receipts).toBe(1);
      expect(networkCalls).toBe(1);
    } finally {
      if (previousMockSetting === undefined) delete process.env.CRYPTO_WATCHER_MOCK;
      else process.env.CRYPTO_WATCHER_MOCK = previousMockSetting;
    }
  });

  it('recovers a stale crypto processing claim and settles it exactly once', async () => {
    const previousMockSetting = process.env.CRYPTO_WATCHER_MOCK;
    process.env.CRYPTO_WATCHER_MOCK = 'false';

    try {
      const now = Date.now();
      const paymentRepo = dataSource.getRepository(Payment);
      const payment = await paymentRepo.save(paymentRepo.create({
        userId: 7102,
        productCode: 'wallet_charge',
        amount: 500,
        currency: 'USDT',
        method: 'crypto_usdt',
        status: 'processing',
        walletAddress: 'TWalletStale',
        createdAt: new Date(now - 30 * 60_000),
        expiresAt: new Date(now + 30 * 60_000),
      }));
      await paymentRepo.update(
        { id: payment.id },
        { updatedAt: new Date(now - 20 * 60_000) } as any,
      );

      const httpService: any = {
        get: () => of({
          data: {
            data: [{
              transaction_id: 'mysql-stale-trc20-tx',
              value: '5000000',
              block_timestamp: now,
              to: 'TWalletStale',
            }],
          },
        }),
      };
      const processor = new CryptoWatcherProcessor(
        paymentRepo,
        {} as any,
        makeWalletService(),
        httpService,
      );

      await processor.process({ name: 'check-pending', data: {} } as any);

      const settled = await paymentRepo.findOneByOrFail({ id: payment.id });
      const wallet = await dataSource.getRepository(UserWallet).findOneByOrFail({ userId: 7102 });
      const receipts = await dataSource.getRepository(PartitionedEvent).count({
        where: {
          userId: 7102,
          idempotencyKey: `payment:${payment.id}:wallet-credit`,
        },
      });

      expect(settled.status).toBe('paid');
      expect(settled.txHash).toBe('mysql-stale-trc20-tx');
      expect(Number(wallet.balance)).toBe(4_500_000);
      expect(receipts).toBe(1);
    } finally {
      if (previousMockSetting === undefined) delete process.env.CRYPTO_WATCHER_MOCK;
      else process.env.CRYPTO_WATCHER_MOCK = previousMockSetting;
    }
  });

  it('does not double-credit when final payment status persistence fails and is retried', async () => {
    const previousMockSetting = process.env.CRYPTO_WATCHER_MOCK;
    process.env.CRYPTO_WATCHER_MOCK = 'false';

    try {
      const now = Date.now();
      const paymentRepo = dataSource.getRepository(Payment);
      const payment = await paymentRepo.save(paymentRepo.create({
        userId: 7103,
        productCode: 'wallet_charge',
        amount: 500,
        currency: 'USDT',
        method: 'crypto_usdt',
        status: 'pending',
        walletAddress: 'TWalletRetry',
        createdAt: new Date(now - 60_000),
        expiresAt: new Date(now + 30 * 60_000),
      }));

      let failPaidWriteOnce = true;
      const faultInjectingRepo = new Proxy(paymentRepo, {
        get(target, property) {
          if (property === 'update') {
            return async (criteria: any, partial: any) => {
              if (failPaidWriteOnce && partial?.status === 'paid') {
                failPaidWriteOnce = false;
                throw new Error('injected failure before final paid status write');
              }
              return target.update(criteria, partial);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const httpService: any = {
        get: () => of({
          data: {
            data: [{
              transaction_id: 'mysql-retry-trc20-tx',
              value: '5000000',
              block_timestamp: now,
              to: 'TWalletRetry',
            }],
          },
        }),
      };
      const processor = new CryptoWatcherProcessor(
        faultInjectingRepo as any,
        {} as any,
        makeWalletService(),
        httpService,
      );
      const job: any = { name: 'check-payment', data: { paymentId: payment.id } };

      await expect(processor.process(job)).rejects.toThrow(
        'injected failure before final paid status write',
      );
      await processor.process(job);

      const settled = await paymentRepo.findOneByOrFail({ id: payment.id });
      const wallet = await dataSource.getRepository(UserWallet).findOneByOrFail({ userId: 7103 });
      const receipts = await dataSource.getRepository(PartitionedEvent).count({
        where: {
          userId: 7103,
          idempotencyKey: `payment:${payment.id}:wallet-credit`,
        },
      });

      expect(settled.status).toBe('paid');
      expect(Number(wallet.balance)).toBe(4_500_000);
      expect(receipts).toBe(1);
    } finally {
      if (previousMockSetting === undefined) delete process.env.CRYPTO_WATCHER_MOCK;
      else process.env.CRYPTO_WATCHER_MOCK = previousMockSetting;
    }
  });

  it('resumes a partially fulfilled wallet bundle without duplicate debit or entitlements', async () => {
    const userId = 7201;
    const checkoutKey = `checkout:${userId}:bundle-retry-1`;
    const bundleCode = 'bundle-retryable';
    const eventService = {
      logWithManager: async (manager: any, event: any) => {
        const repository = manager.getRepository(PartitionedEvent);
        await repository.insert({
          userId: event.userId,
          type: event.type,
          metadata: event.metadata,
          idempotencyKey: event.idempotencyKey ?? null,
        });
        return true;
      },
      log: async (event: any) => {
        await dataSource.transaction(async (manager) => {
          const repository = manager.getRepository(PartitionedEvent);
          await repository.insert({
            userId: event.userId,
            type: event.type,
            metadata: event.metadata,
            idempotencyKey: event.idempotencyKey ?? null,
          });
        });
      },
    };
    const queue: any = {
      enqueueHighCredit: async () => undefined,
      enqueueVip: async () => undefined,
    };
    const phaseService: any = {
      markEverPaid: async () => undefined,
      learnFromFeedback: async () => undefined,
    };

    await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({ id: userId, gender: 'female' }),
    );

    const walletService = new WalletService(
      dataSource.getRepository(UserWallet),
      eventService as any,
      dataSource,
    );
    await walletService.creditOnce(userId, 500, 'test-seed', `seed:${userId}`);

    const creditsService = new CreditsService(
      dataSource.getRepository(UserCredits),
      eventService as any,
      queue,
      dataSource,
    );
    const actualBoostService = new BoostService(
      dataSource.getRepository(UserBoost),
      phaseService,
      eventService as any,
      queue,
      dataSource,
    );
    const vipService = new VipService(
      dataSource.getRepository(UserVip),
      eventService as any,
      queue,
      dataSource,
    );

    const bundle = {
      code: bundleCode,
      active: true,
      price: 100,
      items: [
        { type: 'credits' as const, amount: 50 },
        { type: 'boost' as const, amount: 2 },
        { type: 'vip' as const, amount: 30, durationDays: 30 },
      ],
    };
    const bundleRepo: any = { findOne: async () => bundle };
    const userRepo: any = { findOne: async () => ({ id: userId, gender: 'female' }) };

    let injectBoostFailureOnce = true;
    const boostService: any = {
      grantInstantOnce: async (...args: [number, number, string, string]) => {
        const result = await actualBoostService.grantInstantOnce(...args);
        if (injectBoostFailureOnce) {
          injectBoostFailureOnce = false;
          throw new Error('injected failure after durable boost grant');
        }
        return result;
      },
    };

    const paymentsService = new PaymentsService(
      bundleRepo,
      dataSource.getRepository(UserVip),
      userRepo,
      creditsService,
      boostService,
      phaseService,
      eventService as any,
      {} as any,
      {} as any,
      vipService,
    );

    await walletService.debitOnce(
      userId,
      100,
      `buy:${bundleCode}`,
      checkoutKey,
    );

    const purchaseContext = {
      amountRials: 100,
      source: 'wallet' as const,
      idempotencyKey: checkoutKey,
    };
    await expect(
      paymentsService.grantBundle(userId, bundleCode, purchaseContext),
    ).rejects.toThrow('injected failure after durable boost grant');

    const afterFailureCredits = await dataSource.getRepository(UserCredits)
      .findOneByOrFail({ userId });
    const afterFailureBoost = await dataSource.getRepository(UserBoost)
      .findOne({ where: { user: { id: userId } }, relations: ['user'] });
    const earlyCommercialPurchases = await dataSource.getRepository(PartitionedEvent).count({
      where: { userId, type: EventType.PURCHASE },
    });
    expect(afterFailureCredits.balance).toBe(50);
    expect(afterFailureBoost?.instantCount).toBe(2);
    expect(await dataSource.getRepository(UserVip).count({ where: { userId } })).toBe(0);
    expect(earlyCommercialPurchases).toBe(1); // the boost entitlement receipt only

    // Simulate a caller retry with the same checkout key after a timeout.
    await walletService.debitOnce(
      userId,
      100,
      `buy:${bundleCode}`,
      checkoutKey,
    );
    await paymentsService.grantBundle(userId, bundleCode, purchaseContext);

    const wallet = await dataSource.getRepository(UserWallet).findOneByOrFail({ userId });
    const credits = await dataSource.getRepository(UserCredits).findOneByOrFail({ userId });
    const boost = await dataSource.getRepository(UserBoost)
      .findOne({ where: { user: { id: userId } }, relations: ['user'] });
    const vip = await dataSource.getRepository(UserVip).findOne({
      where: { userId, active: true },
      order: { expiresAt: 'DESC' },
    });
    const events = await dataSource.getRepository(PartitionedEvent).find({ where: { userId } });

    expect(Number(wallet.balance)).toBe(400);
    expect(credits.balance).toBe(50);
    expect(boost?.instantCount).toBe(2);
    expect(vip).toBeTruthy();
    expect(vip!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    expect(events.filter(event => event.type === EventType.CREDITS_SPENT)).toHaveLength(1);
    expect(events.filter(
      event =>
        event.type === EventType.CREDITS_GRANTED &&
        event.metadata?.source === 'bundle_fulfillment',
    )).toHaveLength(1);
    expect(events.filter(event => event.metadata?.entitlement === 'boost')).toHaveLength(1);
    expect(events.filter(event => event.type === EventType.VIP_ACTIVATED)).toHaveLength(1);
    expect(events.filter(
      event => event.type === EventType.PURCHASE && event.metadata?.isCommercialPurchase === true,
    )).toHaveLength(1);

    const expectedPurchaseKey = `purchase:${createHash('sha256').update(checkoutKey).digest('hex').slice(0, 56)}`;
    expect(events.filter(event => event.idempotencyKey === expectedPurchaseKey)).toHaveLength(1);
  });

  it('does not allow two concurrent debits to overdraw one wallet', async () => {
    const service = makeWalletService();
    await service.creditOnce(7003, 1000, 'seed', 'seed:7003');

    const results = await Promise.allSettled([
      service.debitOnce(7003, 800, 'buy:bundle-a', 'checkout:7003:a'),
      service.debitOnce(7003, 800, 'buy:bundle-b', 'checkout:7003:b'),
    ]);

    const wallet = await dataSource.getRepository(UserWallet).findOneByOrFail({ userId: 7003 });
    const debitEvents = await dataSource.getRepository(PartitionedEvent).count({
      where: { userId: 7003, type: EventType.CREDITS_SPENT },
    });

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(Number(wallet.balance)).toBe(200);
    expect(debitEvents).toBe(1);
  });
});
