import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';

function makeController(promotionRaw: string | null) {
  const grantBundle = jest.fn(async () => ({ success: true }));
  const debitOnce = jest.fn(async () => undefined);
  const redisGet = jest.fn(async () => promotionRaw);
  const bundleRepo = {
    findOne: jest.fn(async () => ({
      code: 'vip-month',
      active: true,
      price: 100_000,
    })),
  };

  const controller = new PaymentsController(
    { grantBundle } as any,
    {} as any,
    {} as any,
    {} as any,
    { debitOnce } as any,
    bundleRepo as any,
    { get: redisGet } as any,
  );

  return { controller, grantBundle, debitOnce, redisGet };
}

describe('PaymentsController promotion purchase attribution', () => {
  it('validates the recipient mapping and records promotion metadata without changing price', async () => {
    const h = makeController(
      JSON.stringify({ userId: 42, variant: 'boost', phase: 'warm' }),
    );

    await expect(
      h.controller.buyWithWallet(
        42,
        'vip-month',
        { promotionId: 'promo-0123456789abcdef' },
        'promotion-checkout-key',
      ),
    ).resolves.toEqual({
      success: true,
      message: 'خرید با موفقیت انجام شد',
    });

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
        promotionAttribution: {
          promotionId: 'promo-0123456789abcdef',
          variant: 'boost',
          phase: 'warm',
        },
      }),
    );
  });

  it('rejects a promotion mapped to another user before any wallet debit', async () => {
    const h = makeController(
      JSON.stringify({ userId: 99, variant: 'vip', phase: 'hot' }),
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

  it('rejects unknown or expired promotion IDs before checkout', async () => {
    const h = makeController(null);

    await expect(
      h.controller.buyWithWallet(
        42,
        'vip-month',
        { promotionId: 'promo-0123456789abcdef' },
        'missing-promotion-key',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.debitOnce).not.toHaveBeenCalled();
  });

  it('rejects malformed mappings and malformed IDs before checkout', async () => {
    const malformed = makeController('{not-json');

    await expect(
      malformed.controller.buyWithWallet(
        42,
        'vip-month',
        { promotionId: 'promo-0123456789abcdef' },
        'malformed-map-key',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(malformed.debitOnce).not.toHaveBeenCalled();

    const shortId = makeController(null);
    await expect(
      shortId.controller.buyWithWallet(
        42,
        'vip-month',
        { promotionId: 'short' },
        'short-id-key',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(shortId.redisGet).not.toHaveBeenCalled();
    expect(shortId.debitOnce).not.toHaveBeenCalled();

    const nonStringId = makeController(null);
    await expect(
      nonStringId.controller.buyWithWallet(
        42,
        'vip-month',
        { promotionId: 123 as any },
        'non-string-id-key',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(nonStringId.redisGet).not.toHaveBeenCalled();
    expect(nonStringId.debitOnce).not.toHaveBeenCalled();
  });
});
