import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DataSource, EntitySchema } from 'typeorm';
import { WalletService } from './wallet.service';
import { UserWallet } from './entities/user-wallet.entity';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { EventType } from 'src/user-event/type/event-type.enum';

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
      entities: [walletSchema, eventSchema],
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
