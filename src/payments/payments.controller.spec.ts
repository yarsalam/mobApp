import { describe, expect, it, jest } from '@jest/globals';
import { PaymentsController } from './payments.controller';

function makeController() {
  const grantBundle = jest.fn(async () => ({ success: true }));
  const debitOnce = jest.fn(async () => ({ balance: 1_000_000 }));
  const findOne = jest.fn(async () => ({
    code: 'vip-month',
    price: 100_000,
    active: true,
  }));
  const prepareCheckout = jest.fn(async () => ({
    experimentId: 'pricing-first-purchase-v1',
    assignmentId: 'px_test_assignment',
    variant: 'treatment' as const,
    basePriceRials: 100_000,
    payablePriceRials: 90_000,
    discountBps: 1000,
    currency: 'IRT' as const,
  }));
  const releaseCheckoutReservation = jest.fn(async () => undefined);
  const commitCheckoutReservation = jest.fn(async () => undefined);

  const controller = new PaymentsController(
    { grantBundle } as any,
    {} as any,
    {} as any,
    {} as any,
    { debitOnce } as any,
    { findOne } as any,
    { prepareCheckout, releaseCheckoutReservation, commitCheckoutReservation } as any,
  );

  return {
    controller,
    grantBundle,
    debitOnce,
    findOne,
    prepareCheckout,
    releaseCheckoutReservation,
    commitCheckoutReservation,
  };
}

describe('PaymentsController pricing experiment checkout', () => {
  it('charges the signed treatment price and commits its discount after the successful wallet debit', async () => {
    const h = makeController();

    const result = await h.controller.buyWithWallet(
      42,
      'vip-month',
      { pricingQuoteId: 'signed-quote' },
      'checkout-key-1',
    );

    expect(h.prepareCheckout).toHaveBeenCalledWith(
      42,
      'vip-month',
      'signed-quote',
      'checkout-key-1',
    );
    expect(h.debitOnce).toHaveBeenCalledWith(
      42,
      90_000,
      'buy:vip-month',
      'wallet-checkout:checkout-key-1:debit',
    );
    expect(h.grantBundle).toHaveBeenCalledWith(
      42,
      'vip-month',
      expect.objectContaining({
        amountRials: 90_000,
        source: 'wallet',
        idempotencyKey: 'wallet-checkout:checkout-key-1',
        pricingExperiment: expect.objectContaining({
          experimentId: 'pricing-first-purchase-v1',
          variant: 'treatment',
          basePriceRials: 100_000,
          payablePriceRials: 90_000,
          discountBps: 1000,
        }),
      }),
    );
    expect(h.commitCheckoutReservation).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        experimentId: 'pricing-first-purchase-v1',
        variant: 'treatment',
      }),
      'checkout-key-1',
    );
    expect(h.commitCheckoutReservation.mock.invocationCallOrder[0]).toBeLessThan(
      h.grantBundle.mock.invocationCallOrder[0],
    );
    expect(result).toMatchObject({
      success: true,
      pricingExperiment: {
        experimentId: 'pricing-first-purchase-v1',
        variant: 'treatment',
        discountRials: 10_000,
      },
    });
  });

  it('keeps existing catalogue pricing when the customer is not using an experiment quote', async () => {
    const h = makeController();

    await h.controller.buyWithWallet(42, 'vip-month', undefined, 'regular-key');

    expect(h.prepareCheckout).not.toHaveBeenCalled();
    expect(h.debitOnce).toHaveBeenCalledWith(
      42,
      100_000,
      'buy:vip-month',
      'wallet-checkout:regular-key:debit',
    );
    expect(h.grantBundle).toHaveBeenCalledWith(
      42,
      'vip-month',
      expect.not.objectContaining({ pricingExperiment: expect.anything() }),
    );
    expect(h.commitCheckoutReservation).not.toHaveBeenCalled();
  });

  it('does not debit the wallet when the signed quote cannot be verified', async () => {
    const h = makeController();
    h.prepareCheckout.mockRejectedValueOnce(new Error('invalid quote signature'));

    await expect(
      h.controller.buyWithWallet(
        42,
        'vip-month',
        { pricingQuoteId: 'tampered' },
        'checkout-key-2',
      ),
    ).rejects.toThrow('invalid quote signature');

    expect(h.debitOnce).not.toHaveBeenCalled();
    expect(h.grantBundle).not.toHaveBeenCalled();
  });

  it('releases the discount reservation only for an explicit insufficient-balance failure', async () => {
    const h = makeController();
    h.debitOnce.mockRejectedValueOnce({ code: 'INSUFFICIENT_BALANCE' });

    await expect(
      h.controller.buyWithWallet(
        42,
        'vip-month',
        { pricingQuoteId: 'signed-quote' },
        'checkout-key-3',
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });

    expect(h.releaseCheckoutReservation).toHaveBeenCalledWith(
      42,
      'pricing-first-purchase-v1',
      'checkout-key-3',
    );
    expect(h.grantBundle).not.toHaveBeenCalled();
    expect(h.commitCheckoutReservation).not.toHaveBeenCalled();
  });

  it('keeps the reservation after an ambiguous debit error so the same key can retry safely', async () => {
    const h = makeController();
    h.debitOnce.mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      h.controller.buyWithWallet(
        42,
        'vip-month',
        { pricingQuoteId: 'signed-quote' },
        'checkout-key-4',
      ),
    ).rejects.toThrow('connection reset');

    expect(h.releaseCheckoutReservation).not.toHaveBeenCalled();
    expect(h.grantBundle).not.toHaveBeenCalled();
  });

  it('requires the mobile idempotency key before any checkout side effect', async () => {
    const h = makeController();

    await expect(
      h.controller.buyWithWallet(42, 'vip-month', { pricingQuoteId: 'quote' }, undefined),
    ).rejects.toThrow('Idempotency-Key header is required');

    expect(h.prepareCheckout).not.toHaveBeenCalled();
    expect(h.debitOnce).not.toHaveBeenCalled();
  });
});
