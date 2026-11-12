import { describe, expect, it, jest } from '@jest/globals';
import { PaymentsController } from './payments.controller';

function makeController() {
  const paymentsService = {
    grantBundle: jest.fn().mockResolvedValue({ success: true }),
  };
  const cardTransferProvider = {};
  const cryptoProvider = {};
  const manualVerifier = {};
  const walletService = {
    debitOnce: jest.fn().mockResolvedValue({ balance: 1000 }),
  };
  const promotionExposure = {
    trackConversion: jest.fn().mockResolvedValue({ success: true, duplicate: false }),
  };
  const bundleRepo = {
    findOne: jest.fn().mockResolvedValue({ code: 'starter_bundle', price: 2500, active: true }),
  };
  const controller = new PaymentsController(
    paymentsService as any,
    cardTransferProvider as any,
    cryptoProvider as any,
    manualVerifier as any,
    walletService as any,
    promotionExposure as any,
    bundleRepo as any,
  );
  return {
    controller,
    paymentsService,
    walletService,
    promotionExposure,
    bundleRepo,
  };
}

describe('PaymentsController promotion purchase attribution', () => {
  it('persists the same promotion ID with the wallet purchase and conversion event', async () => {
    const { controller, paymentsService, walletService, promotionExposure } = makeController();
    const promotionId = '123e4567-e89b-42d3-a456-426614174000';

    const result = await controller.buyWithWallet(
      42,
      'starter_bundle',
      { promotionId },
      'idempotency-key-1',
    );

    expect(walletService.debitOnce).toHaveBeenCalledWith(
      42,
      2500,
      'buy:starter_bundle',
      'wallet-checkout:idempotency-key-1:debit',
    );
    expect(paymentsService.grantBundle).toHaveBeenCalledWith(
      42,
      'starter_bundle',
      expect.objectContaining({
        amountRials: 2500,
        source: 'wallet',
        idempotencyKey: 'wallet-checkout:idempotency-key-1',
        promotionId,
      }),
    );
    expect(promotionExposure.trackConversion).toHaveBeenCalledWith(
      42,
      promotionId,
      'idempotency-key-1',
      'starter_bundle',
    );
    expect(result).toEqual({
      success: true,
      message: 'خرید با موفقیت انجام شد',
      promotionAttribution: 'recorded',
    });
  });

  it('validates the promotion ID before debiting the wallet', async () => {
    const { controller, walletService, paymentsService } = makeController();

    await expect(
      controller.buyWithWallet(42, 'starter_bundle', { promotionId: 'not-a-uuid' }, 'key-2'),
    ).rejects.toThrow('promotionId must be a valid promotion exposure ID');

    expect(walletService.debitOnce).not.toHaveBeenCalled();
    expect(paymentsService.grantBundle).not.toHaveBeenCalled();
  });

  it('keeps a successful purchase successful if attribution storage is temporarily unavailable', async () => {
    const { controller, promotionExposure } = makeController();
    promotionExposure.trackConversion.mockRejectedValue(new Error('Redis unavailable'));

    const result = await controller.buyWithWallet(
      42,
      'starter_bundle',
      { promotionId: '123e4567-e89b-42d3-a456-426614174000' },
      'idempotency-key-3',
    );

    expect(result).toEqual({
      success: true,
      message: 'خرید با موفقیت انجام شد',
      promotionAttribution: 'failed',
    });
  });
});
