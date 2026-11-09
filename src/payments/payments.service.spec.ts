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
  });

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
