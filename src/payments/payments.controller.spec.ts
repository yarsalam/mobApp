import { describe, expect, it, jest } from '@jest/globals';
import { PaymentsController } from './payments.controller';

function makeController() {
  const grantBundle = jest.fn(async () => ({ success: true }));
  const debitOnce = jest.fn(async () => ({ balance: 1000 }));
  const trackConversion = jest.fn(async () => ({ success: true, duplicate: false }));
  const findOne = jest.fn(async () => ({
    code: 'starter_bundle',
    price: 2500,
    active: true,
  }));

  const controller = new PaymentsController(
    { grantBundle } as any,
    {} as any,
    {} as any,
    {} as any,
    { debitOnce } as any,
    { trackConversion } as any,
    { findOne } as any,
  );

  return { controller, grantBundle, debitOnce, trackConversion, findOne };
}

describe('PaymentsController promotion purchase attribution', () => {
  it('persists the same promotion ID with the wallet purchase and conversion event', async () => {
    const { controller, grantBundle, debitOnce, trackConversion } = makeController();
    const promotionId = '123e4567-e89b-42d3-a456-426614174000';

    const result = await controller.buyWithWallet(
      42,
      'starter_bundle',
      { promotionId },
      'idempotency-key-1',
    );

    expect(debitOnce).toHaveBeenCalledWith(
      42,
      2500,
      'buy:starter_bundle',
      'wallet-checkout:idempotency-key-1:debit',
    );
    expect(grantBundle).toHaveBeenCalledWith(
      42,
      'starter_bundle',
      expect.objectContaining({
        amountRials: 2500,
        source: 'wallet',
        idempotencyKey: 'wallet-checkout:idempotency-key-1',
        promotionId,
      }),
    );
    expect(trackConversion).toHaveBeenCalledWith(
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
    const { controller, debitOnce, grantBundle } = makeController();

    await expect(
      controller.buyWithWallet(42, 'starter_bundle', { promotionId: 'not-a-uuid' }, 'key-2'),
    ).rejects.toThrow('promotionId must be a valid promotion exposure ID');

    expect(debitOnce).not.toHaveBeenCalled();
    expect(grantBundle).not.toHaveBeenCalled();
  });

  it('keeps a successful purchase successful if attribution storage is temporarily unavailable', async () => {
    const { controller, trackConversion } = makeController();
    trackConversion.mockImplementation(async () => {
      throw new Error('Redis unavailable');
    });

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
