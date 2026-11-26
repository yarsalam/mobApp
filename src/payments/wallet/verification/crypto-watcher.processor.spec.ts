import { describe, expect, it, jest } from '@jest/globals';
import { of } from 'rxjs';
import { CryptoWatcherProcessor } from './crypto-watcher.processor';

const PAYMENT_ID = 42;
const TOKEN_CONTRACT = 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function createHarness(value: unknown) {
  const previousMockSetting = process.env.CRYPTO_WATCHER_MOCK;
  const previousContract = process.env.USDT_TRC20_CONTRACT;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.CRYPTO_WATCHER_MOCK = 'false';
  process.env.USDT_TRC20_CONTRACT = TOKEN_CONTRACT;
  process.env.NODE_ENV = 'test';

  const now = Date.now();
  const payment = {
    id: PAYMENT_ID,
    userId: 7,
    productCode: 'wallet_charge',
    method: 'crypto_usdt',
    status: 'processing',
    currency: 'USDT',
    amount: 500,
    walletAddress: 'TWallet',
    createdAt: new Date(now - 60_000),
    metadata: { requestedAmountRials: 4_500_000, rateRialsPerUsdt: 900_000 },
  };

  const tx = {
    transaction_id: 'a'.repeat(64),
    value,
    token_info: { address: TOKEN_CONTRACT },
    block_timestamp: now,
    to: payment.walletAddress,
  };

  const paymentRepo: any = {
    update: jest.fn<() => Promise<any>>().mockResolvedValue({ affected: 1 }),
    findOne: jest.fn<() => Promise<any>>()
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce(null),
  };
  const walletService: any = {
    creditOnce: jest.fn<() => Promise<any>>().mockResolvedValue(undefined),
  };
  const entitlementService: any = {
    grantFromPayment: jest.fn<() => Promise<any>>().mockResolvedValue(undefined),
  };
  const httpService: any = {
    get: jest.fn().mockReturnValue(of({ data: { data: [tx] } })),
  };

  const processor = new CryptoWatcherProcessor(
    paymentRepo,
    entitlementService,
    walletService,
    httpService,
  );

  const restoreEnvironment = () => {
    if (previousMockSetting === undefined) delete process.env.CRYPTO_WATCHER_MOCK;
    else process.env.CRYPTO_WATCHER_MOCK = previousMockSetting;
    if (previousContract === undefined) delete process.env.USDT_TRC20_CONTRACT;
    else process.env.USDT_TRC20_CONTRACT = previousContract;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  };

  return {
    processor,
    payment,
    paymentRepo,
    walletService,
    entitlementService,
    httpService,
    restoreEnvironment,
  };
}

describe('CryptoWatcherProcessor TRC20 transfer validation', () => {
  it('accepts a digit-only USDT base-unit value and settles the wallet top-up once', async () => {
    const h = createHarness('5000000');

    try {
      await h.processor.process({
        name: 'check-payment',
        data: { paymentId: PAYMENT_ID },
      } as any);

      expect(h.httpService.get).toHaveBeenCalledWith(
        expect.stringContaining('/v1/accounts/TWallet/transactions/trc20'),
        expect.objectContaining({
          params: expect.objectContaining({
            limit: 50,
            only_confirmed: true,
            contract_address: TOKEN_CONTRACT.toLowerCase(),
          }),
        }),
      );
      expect(h.walletService.creditOnce).toHaveBeenCalledTimes(1);
      expect(h.walletService.creditOnce).toHaveBeenCalledWith(
        7,
        4_500_000,
        `payment:${PAYMENT_ID}`,
        `payment:${PAYMENT_ID}:wallet-credit`,
      );
      expect(h.entitlementService.grantFromPayment).not.toHaveBeenCalled();
      expect(h.paymentRepo.update).toHaveBeenLastCalledWith(
        { id: PAYMENT_ID, status: 'processing' },
        {
          status: 'paid',
          confirmedAt: expect.any(Date),
        },
      );
    } finally {
      h.restoreEnvironment();
    }
  });

  it.each([
    { label: 'non-numeric text', value: 'not-a-number' },
    { label: 'a negative value', value: '-5000000' },
    { label: 'a decimal value', value: '5.000000' },
    { label: 'a JavaScript number instead of a string', value: 5000000 },
  ])('does not settle a transfer with $label', async ({ value }) => {
    const h = createHarness(value);

    try {
      await h.processor.process({
        name: 'check-payment',
        data: { paymentId: PAYMENT_ID },
      } as any);

      expect(h.walletService.creditOnce).not.toHaveBeenCalled();
      expect(h.entitlementService.grantFromPayment).not.toHaveBeenCalled();
      expect(h.paymentRepo.update).toHaveBeenLastCalledWith(
        { id: PAYMENT_ID, status: 'processing' },
        { status: 'pending' },
      );
    } finally {
      h.restoreEnvironment();
    }
  });
  it('does not credit a transfer from a different TRC20 token contract', async () => {
    const h = createHarness('5000000');
    h.httpService.get.mockReturnValue(
      of({
        data: {
          data: [
            {
              transaction_id: 'b'.repeat(64),
              value: '5000000',
              block_timestamp: Date.now(),
              to: h.payment.walletAddress,
              token_info: { address: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' },
            },
          ],
        },
      }),
    );

    try {
      await h.processor.process({
        name: 'check-payment',
        data: { paymentId: PAYMENT_ID },
      } as any);

      expect(h.walletService.creditOnce).not.toHaveBeenCalled();
      expect(h.paymentRepo.update).toHaveBeenLastCalledWith(
        { id: PAYMENT_ID, status: 'processing' },
        { status: 'pending' },
      );
    } finally {
      h.restoreEnvironment();
    }
  });

  it('forbids mock auto-confirmation in production', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousMockSetting = process.env.CRYPTO_WATCHER_MOCK;
    process.env.NODE_ENV = 'production';
    process.env.CRYPTO_WATCHER_MOCK = 'true';

    try {
      expect(
        () =>
          new CryptoWatcherProcessor(
            {} as any,
            {} as any,
            {} as any,
            {} as any,
          ),
      ).toThrow('forbidden in production');
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousMockSetting === undefined) delete process.env.CRYPTO_WATCHER_MOCK;
      else process.env.CRYPTO_WATCHER_MOCK = previousMockSetting;
    }
  });

});
