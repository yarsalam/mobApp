import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';

function makeController() {
  const grantBundle = jest.fn(async () => ({ success: true }));
  const debitOnce = jest.fn(async () => undefined);
  const findOne = jest.fn(async () => ({
    code: 'vip-month',
    active: true,
    price: 100_000,
  }));
  const redisGet = jest
    .fn<() => Promise<string | null>>()
    .mockResolvedValue(
      JSON.stringify({ userId: 42, variant: 'boost', phase: 'warm' }),
    );

  const controller = new PaymentsController(
    { grantBundle } as any,
    {} as any,
    {} as any,
    {} as any,
    { debitOnce } as any,
    { findOne } as any,
    { get: redisGet } as any,
  );

  return { controller, grantBundle, debitOnce, findOne, redisGet };
}

describe('PaymentsController promotion checkout attribution', () => {
  it('validates the promotion owner and carries attribution into purchase fulfillment', async () => {
    const h = makeController();

    await expect(
      h.controller.buyWithWallet(
        42,
        'vip-month',
        { promotionId: 'promo-0123456789abcdef' },
        'promotion-checkout-key',
      ),
    ).resolves.toEqual({ success: true, message: 'خرید با موفقیت انجام شد' });

    expect(h.redisGet).toHaveBeenCalledWith(
      'promo:map:promo-0123456789abcdef',
    );
    expect(h.debitOnce).toHaveBeenCalledWith(
      42,
      100_000,
      'buy:vip-month',
      'wallet-checkout:promotion-checkout-key:debit',
    );
    expect(h.grantBundle).toHaveBeenCalledWith(
      42,
      'vip-month',
      expect.objectContaining({
        amountRials: 100_000,
        source: 'wallet',
        promotionAttribution: {
          promotionId: 'promo-0123456789abcdef',
          variant: 'boost',
          phase: 'warm',
        },
      }),
    );
  });

  it('rejects another user promotion before wallet debit', async () => {
    const h = makeController();
    h.redisGet.mockResolvedValueOnce(
      JSON.stringify({ userId: 99, variant: 'boost', phase: 'warm' }),
    );

    await expect(
      h.controller.buyWithWallet(
        42,
        'vip-month',
        { promotionId: 'promo-0123456789abcdef' },
        'foreign-promotion-key',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.debitOnce).not.toHaveBeenCalled();
    expect(h.grantBundle).not.toHaveBeenCalled();
  });

  it('rejects missing, malformed or expired mappings before wallet debit', async () => {
    const h = makeController();
    h.redisGet.mockResolvedValueOnce(null);

    await expect(
      h.controller.buyWithWallet(
        42,
        'vip-month',
        { promotionId: 'promo-0123456789abcdef' },
        'expired-promotion-key',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    h.redisGet.mockResolvedValueOnce('{invalid-json');
    await expect(
      h.controller.buyWithWallet(
        42,
        'vip-month',
        { promotionId: 'promo-0123456789abcdef' },
        'malformed-promotion-key',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.debitOnce).not.toHaveBeenCalled();
    expect(h.grantBundle).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs and unsafe variants before wallet debit', async () => {
    const h = makeController();

    await expect(
      h.controller.buyWithWallet(
        42,
        'vip-month',
        { promotionId: 'not-safe' },
        'invalid-id-key',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    h.redisGet.mockResolvedValueOnce(
      JSON.stringify({ userId: 42, variant: '../payments' }),
    );
    await expect(
      h.controller.buyWithWallet(
        42,
        'vip-month',
        { promotionId: 'promo-0123456789abcdef' },
        'invalid-variant-key',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.debitOnce).not.toHaveBeenCalled();
    expect(h.grantBundle).not.toHaveBeenCalled();
  });

  it('does not read Redis or alter checkout when promotion attribution is absent', async () => {
    const h = makeController();

    await h.controller.buyWithWallet(
      42,
      'vip-month',
      undefined,
      'ordinary-checkout-key',
    );

    expect(h.redisGet).not.toHaveBeenCalled();
    expect(h.debitOnce).toHaveBeenCalledTimes(1);
    expect(h.grantBundle).toHaveBeenCalledWith(
      42,
      'vip-month',
      expect.objectContaining({
        amountRials: 100_000,
        source: 'wallet',
      }),
    );
  });
});
