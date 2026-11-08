import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { EventType } from 'src/user-event/type/event-type.enum';

function createHarness(existingEvent: any = null, updateAffected = 1) {
  const builder: any = {
    insert: jest.fn(() => builder),
    values: jest.fn(() => builder),
    orIgnore: jest.fn(() => builder),
    update: jest.fn(() => builder),
    set: jest.fn(() => builder),
    where: jest.fn(() => builder),
    execute: jest.fn().mockResolvedValue({ affected: updateAffected }),
  };
  const eventRepo: any = {
    findOne: jest.fn().mockResolvedValue(existingEvent),
  };
  const walletTxRepo: any = {
    createQueryBuilder: jest.fn(() => builder),
    findOne: jest.fn().mockResolvedValue({ userId: 7, balance: 900 }),
  };
  const manager: any = {
    getRepository: jest.fn((entity: unknown) =>
      entity === PartitionedEvent ? eventRepo : walletTxRepo,
    ),
  };
  const dataSource: any = {
    transaction: jest.fn(async (callback: (manager: any) => Promise<unknown>) =>
      callback(manager),
    ),
  };
  const rootRepo: any = {
    insert: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue({
      userId: 7,
      balance: 900,
      currency: 'IRT',
    }),
  };
  const userEventService: any = {
    logWithManager: jest.fn().mockResolvedValue(true),
    log: jest.fn().mockResolvedValue(undefined),
  };
  const service = new WalletService(rootRepo, userEventService, dataSource);

  return {
    service,
    builder,
    eventRepo,
    walletTxRepo,
    manager,
    dataSource,
    rootRepo,
    userEventService,
  };
}

describe('WalletService idempotent mutations', () => {
  it('commits a wallet credit and its idempotency receipt in the same transaction', async () => {
    const h = createHarness();

    await h.service.creditOnce(7, 500, 'payment:44', 'payment:44:wallet-credit');

    expect(h.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(h.builder.insert).toHaveBeenCalledTimes(1);
    expect(h.builder.update).toHaveBeenCalledTimes(1);
    expect(h.userEventService.logWithManager).toHaveBeenCalledWith(
      h.manager,
      expect.objectContaining({
        userId: 7,
        type: EventType.CREDITS_GRANTED,
        idempotencyKey: 'payment:44:wallet-credit',
        metadata: expect.objectContaining({
          amountRials: 500,
          source: 'payment:44',
        }),
      }),
    );
  });

  it('does not credit again when the durable receipt already exists', async () => {
    const h = createHarness({
      id: 1,
      userId: 7,
      type: EventType.CREDITS_GRANTED,
      idempotencyKey: 'payment:44:wallet-credit',
      metadata: { amountRials: 500, source: 'payment:44' },
    });

    await h.service.creditOnce(7, 500, 'payment:44', 'payment:44:wallet-credit');

    expect(h.walletTxRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(h.userEventService.logWithManager).not.toHaveBeenCalled();
    expect(h.rootRepo.findOne).toHaveBeenCalled();
  });

  it('rejects reuse of a receipt key for a different amount or source', async () => {
    const h = createHarness({
      id: 1,
      userId: 7,
      type: EventType.CREDITS_GRANTED,
      idempotencyKey: 'payment:44:wallet-credit',
      metadata: { amountRials: 500, source: 'payment:44' },
    });

    await expect(
      h.service.creditOnce(7, 700, 'payment:44', 'payment:44:wallet-credit'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.walletTxRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('does not record a spend event when the atomic debit finds insufficient balance', async () => {
    const h = createHarness(null, 0);

    await expect(
      h.service.debitOnce(7, 1_000, 'buy:bundle-monthly', 'wallet-checkout:abc:debit'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.userEventService.logWithManager).not.toHaveBeenCalled();
  });
});
