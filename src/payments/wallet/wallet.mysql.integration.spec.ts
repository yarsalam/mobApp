import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource, EntitySchema } from 'typeorm';
import { WalletService } from './wallet.service';
import { UserWallet } from './entities/user-wallet.entity';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { EventType } from 'src/user-event/type/event-type.enum';
import { Payment } from 'src/payments/entities/payment.entity';
import { CryptoWatcherProcessor } from './verification/crypto-watcher.processor';
import { of } from 'rxjs';

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
      entities: [walletSchema, eventSchema, paymentSchema],
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
