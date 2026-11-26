import { CreditsService } from './credits.service';
import { UserCredits } from './entities/user-credits.entity';
import { PaywallException } from '../paywall/paywall.exception';

describe('CreditsService.consume', () => {
  function harness(affected: number, balance = 5) {
    const managerBuilder = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn()
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValueOnce({ affected }),
    };
    const managerRepo = {
      createQueryBuilder: jest.fn(() => managerBuilder),
      findOne: jest.fn().mockResolvedValue({ userId: 7, balance }),
    };
    const manager = { getRepository: jest.fn(() => managerRepo) };
    const dataSource = {
      transaction: jest.fn(async (callback: any) => callback(manager)),
    };
    const resultBuilder = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const repository = {
      createQueryBuilder: jest.fn(() => resultBuilder),
      findOne: jest.fn().mockResolvedValue({ userId: 7, balance: balance - 2 }),
    };
    const userEventService = { logWithManager: jest.fn().mockResolvedValue(undefined) };
    const service = new CreditsService(
      repository as any,
      userEventService as any,
      {} as any,
      dataSource as any,
    );
    return { service, managerBuilder, managerRepo, dataSource, userEventService };
  }

  it('debits only when the database balance is sufficient and logs in the same transaction', async () => {
    const h = harness(1);

    await h.service.consume(7, 2, 'message');

    expect(h.managerBuilder.set).toHaveBeenCalledWith({
      balance: expect.any(Function),
    });
    expect(h.managerBuilder.where).toHaveBeenCalledWith(
      'userId = :userId AND balance >= :amount',
      { userId: 7, amount: 2 },
    );
    expect(h.userEventService.logWithManager).toHaveBeenCalledTimes(1);
    expect(h.dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a concurrent debit when the conditional update affects no row', async () => {
    const h = harness(0, 0);

    await expect(h.service.consume(7, 2, 'message')).rejects.toBeInstanceOf(
      PaywallException,
    );
    expect(h.userEventService.logWithManager).not.toHaveBeenCalled();
  });

  it('rejects non-positive or unsafe debit amounts before opening a transaction', async () => {
    const h = harness(1);

    await expect(h.service.consume(7, -1, 'message')).rejects.toThrow(
      'positive safe integer',
    );
    expect(h.dataSource.transaction).not.toHaveBeenCalled();
  });
});
