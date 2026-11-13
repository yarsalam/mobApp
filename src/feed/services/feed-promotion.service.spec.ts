import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { EventType } from 'src/user-event/type/event-type.enum';
import { FeedPromotionService } from './feed-promotion.service';

describe('FeedPromotionService interaction attribution', () => {
  const userId = 42;
  const promotionId = 'promo-0123456789abcdef';

  function makeService() {
    const service = Object.create(
      FeedPromotionService.prototype,
    ) as FeedPromotionService;
    const redis = {
      get: jest.fn<(key: string) => Promise<string | null>>().mockResolvedValue(
        JSON.stringify({
          userId,
          variant: 'boost',
          phase: 'warm',
          score: 0.81,
        }),
      ),
      set: jest
        .fn<
          (key: string, value: string, ...args: (string | number)[]) => Promise<'OK' | null>
        >()
        .mockResolvedValue('OK'),
      del: jest.fn<(key: string) => Promise<number>>().mockResolvedValue(1),
    };
    const exposureService = {
      trackDismiss: jest
        .fn<(userId: number, variant: string, promotionId: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const userEventService = {
      log: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    };

    Object.assign(service, { redis, exposureService, userEventService });
    return { service, redis, exposureService, userEventService };
  }

  it('records a click against the original promotion ID exactly once', async () => {
    const { service, redis, userEventService } = makeService();

    await expect(
      service.trackPromotionClick(userId, promotionId),
    ).resolves.toEqual({ success: true, duplicate: false });

    expect(userEventService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        type: EventType.PROMOTION_CLICKED,
        idempotencyKey: `promotion:${promotionId}:click`,
        metadata: expect.objectContaining({ promotionId, variant: 'boost' }),
      }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      `promo:interaction:click:${promotionId}`,
      '1',
      'EX',
      30 * 24 * 60 * 60,
      'NX',
    );
  });

  it('records dismiss feedback and a durable dismiss event', async () => {
    const { service, exposureService, userEventService } = makeService();

    await expect(
      service.dismissPromotion(userId, promotionId),
    ).resolves.toEqual({ success: true, duplicate: false });

    expect(exposureService.trackDismiss).toHaveBeenCalledWith(
      userId,
      'boost',
      promotionId,
    );
    expect(userEventService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EventType.PROMOTION_DISMISSED,
        idempotencyKey: `promotion:${promotionId}:dismiss`,
      }),
    );
  });

  it('does not write a second event for duplicate requests', async () => {
    const { service, redis, exposureService, userEventService } = makeService();
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await service.dismissPromotion(userId, promotionId);
    await expect(
      service.dismissPromotion(userId, promotionId),
    ).resolves.toEqual({ success: true, duplicate: true });

    expect(userEventService.log).toHaveBeenCalledTimes(1);
    expect(exposureService.trackDismiss).toHaveBeenCalledTimes(1);
  });

  it('rejects an interaction for another user without writing an event', async () => {
    const { service, redis, userEventService } = makeService();
    redis.get.mockResolvedValueOnce(
      JSON.stringify({ userId: userId + 1, variant: 'boost' }),
    );

    await expect(
      service.trackPromotionClick(userId, promotionId),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(userEventService.log).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('releases the duplicate guard when durable event writing fails', async () => {
    const { service, redis, userEventService } = makeService();
    userEventService.log.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      service.trackPromotionClick(userId, promotionId),
    ).rejects.toThrow('database unavailable');

    expect(redis.del).toHaveBeenCalledWith(
      `promo:interaction:click:${promotionId}`,
    );
  });
});
