import { describe, expect, it, jest } from '@jest/globals';
import { PaymentsService } from './payments.service';

function makeService(gender: string | null) {
  const bundleRepo: any = {
    findOne: jest.fn<() => Promise<any>>().mockResolvedValue({
      code: 'bundle-monthly',
      active: true,
      price: 250_000,
      items: [],
    }),
  };
  const userRepo: any = {
    findOne: jest.fn<() => Promise<any>>().mockResolvedValue({
      id: 7,
      gender,
    }),
  };
  const eventService: any = {
    log: jest.fn<() => Promise<any>>().mockResolvedValue(undefined),
  };
  const phaseService: any = {
    markEverPaid: jest.fn<() => Promise<any>>().mockResolvedValue(undefined),
    learnFromFeedback: jest.fn<() => Promise<any>>().mockResolvedValue(undefined),
  };
  const service = new PaymentsService(
    bundleRepo,
    {} as any,
    userRepo,
    {} as any,
    {} as any,
    phaseService,
    eventService,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, userRepo, eventService };
}

describe('PaymentsService purchase attribution', () => {
  it('stores a normalized female snapshot on the fulfilled purchase event', async () => {
    const h = makeService('خانم');

    await h.service.grantBundle(7, 'bundle-monthly', {
      amountRials: 250_000,
      source: 'wallet',
      idempotencyKey: 'wallet-checkout:test',
    });

    expect(h.userRepo.findOne).toHaveBeenCalledWith({
      where: { id: 7 },
      select: ['id', 'gender'],
    });
    expect(h.eventService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.any(String),
        metadata: expect.objectContaining({
          genderAtPurchase: 'female',
          isCommercialPurchase: true,
        }),
      }),
    );

    // A later profile edit must not mutate the event's immutable attribution.
    h.userRepo.findOne.mockResolvedValue({ id: 7, gender: 'male' });
    const currentProfile = await h.userRepo.findOne({ where: { id: 7 } });
    const purchaseEvent = h.eventService.log.mock.calls[0][0] as any;
    expect(currentProfile.gender).toBe('male');
    expect(purchaseEvent.metadata.genderAtPurchase).toBe('female');
  });



  it('persists original promotion attribution on the commercial purchase event', async () => {
    const h = makeService('female');

    await h.service.grantBundle(7, 'bundle-monthly', {
      amountRials: 250_000,
      source: 'wallet',
      idempotencyKey: 'wallet-checkout:promotion-test',
      promotionAttribution: {
        promotionId: 'promo-0123456789abcdef',
        variant: 'boost',
        phase: 'warm',
      },
    });

    expect(h.eventService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.any(String),
        metadata: expect.objectContaining({
          bundleCode: 'bundle-monthly',
          isCommercialPurchase: true,
          promotion: {
            promotionId: 'promo-0123456789abcdef',
            variant: 'boost',
            phase: 'warm',
          },
        }),
      }),
    );
  });

  it.each(['male', 'man', 'm', 'مرد', 'آقا', 'اقا'])(
    'normalizes male profile value %s to the male snapshot',
    async (gender) => {
      const h = makeService(gender);
      await h.service.grantBundle(7, 'bundle-monthly', {
        amountRials: 250_000,
        source: 'payment',
      });
      const purchaseEvent = h.eventService.log.mock.calls[0][0] as any;
      expect(purchaseEvent.metadata.genderAtPurchase).toBe('male');
    },
  );

  it.each(['female', 'woman', 'f', 'زن', 'خانم'])(
    'normalizes female profile value %s to the female snapshot',
    async (gender) => {
      const h = makeService(gender);
      await h.service.grantBundle(7, 'bundle-monthly', {
        amountRials: 250_000,
        source: 'payment',
      });
      const purchaseEvent = h.eventService.log.mock.calls[0][0] as any;
      expect(purchaseEvent.metadata.genderAtPurchase).toBe('female');
    },
  );

  it('stores unknown instead of inventing a gender when the profile value is absent', async () => {
    const h = makeService(null);

    await h.service.grantBundle(7, 'bundle-monthly', {
      amountRials: 250_000,
      source: 'payment',
    });

    expect(h.eventService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ genderAtPurchase: 'unknown' }),
      }),
    );
  });
});
