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
  const prepareCheckout = jest.fn(async () => ({
    experimentId: 'pricing-2026-01',
    assignmentId: 'px_test_assignment',
    variant: 'treatment' as const,
    basePriceRials: 2500,
    payablePriceRials: 2000,
    discountBps: 2000,
    currency: 'IRT' as const,
  }));
  const releaseTreatmentReservation = jest.fn(async () => undefined);

  const controller = new PaymentsController(
    { grantBundle } as any,
    {} as any,
    {} as any,
    {} as any,
    { debitOnce } as any,
    { trackConversion } as any,
    { findOne } as any,
    { prepareCheckout, releaseTreatmentReservation } as any,
  );

  return { controller, grantBundle, debitOnce, trackConversion, findOne, prepareCheckout, releaseTreatmentReservation };
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

describe('PaymentsController signed pricing experiment checkout', () => {
  it('debits the server-signed treatment price and stores the same assignment on purchase', async () => {
    const { controller, debitOnce, grantBundle, prepareCheckout } = makeController();

    const result = await controller.buyWithWallet(
      42,
      'starter_bundle',
      { pricingQuoteId: 'server-signed-quote' },
      'pricing-idempotency-1',
    );

    expect(prepareCheckout).toHaveBeenCalledWith(
      42,
      'starter_bundle',
      'server-signed-quote',
      'pricing-idempotency-1',
    );
    expect(debitOnce).toHaveBeenCalledWith(
      42,
      2000,
      'buy:starter_bundle',
      'wallet-checkout:pricing-idempotency-1:debit',
    );
    expect(grantBundle).toHaveBeenCalledWith(
      42,
      'starter_bundle',
      expect.objectContaining({
        amountRials: 2000,
        pricingExperiment: expect.objectContaining({
          experimentId: 'pricing-2026-01',
          assignmentId: 'px_test_assignment',
          variant: 'treatment',
          basePriceRials: 2500,
          payablePriceRials: 2000,
          discountBps: 2000,
          currency: 'IRT',
        }),
      }),
    );
    expect(result).toMatchObject({
      success: true,
      pricingExperiment: {
        experimentId: 'pricing-2026-01',
        variant: 'treatment',
        discountRials: 500,
      },
    });
  });

  it('does not debit when the signed quote cannot be verified', async () => {
    const { controller, debitOnce, prepareCheckout, grantBundle } = makeController();
    prepareCheckout.mockRejectedValueOnce(new Error('invalid signature'));

    await expect(
      controller.buyWithWallet(
        42,
        'starter_bundle',
        { pricingQuoteId: 'tampered' },
        'pricing-idempotency-2',
      ),
    ).rejects.toThrow('invalid signature');

    expect(debitOnce).not.toHaveBeenCalled();
    expect(grantBundle).not.toHaveBeenCalled();
  });

  it('releases the treatment reservation only for a confirmed insufficient-balance failure', async () => {
    const { controller, debitOnce, releaseTreatmentReservation, grantBundle } = makeController();
    debitOnce.mockRejectedValueOnce({ code: 'INSUFFICIENT_BALANCE' });

    await expect(
      controller.buyWithWallet(
        42,
        'starter_bundle',
        { pricingQuoteId: 'server-signed-quote' },
        'pricing-idempotency-3',
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });

    expect(releaseTreatmentReservation).toHaveBeenCalledWith(
      42,
      'pricing-2026-01',
      'pricing-idempotency-3',
    );
    expect(grantBundle).not.toHaveBeenCalled();
  });

  it('does not release a treatment reservation after an ambiguous debit failure', async () => {
    const { controller, debitOnce, releaseTreatmentReservation } = makeController();
    debitOnce.mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      controller.buyWithWallet(
        42,
        'starter_bundle',
        { pricingQuoteId: 'server-signed-quote' },
        'pricing-idempotency-4',
      ),
    ).rejects.toThrow('connection reset');

    expect(releaseTreatmentReservation).not.toHaveBeenCalled();
  });
});
