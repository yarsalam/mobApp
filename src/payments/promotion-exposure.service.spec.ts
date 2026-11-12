import { describe, expect, it, jest } from '@jest/globals';
import { of } from 'rxjs';
import { PromotionExposureService } from './promotion-exposure.service';
import { EventType } from 'src/user-event/type/event-type.enum';

const featureSnapshot = {
  engagement_score: 0.8,
  days_since_signup: 30,
  dismiss_rate: 0.1,
  last_purchase_days: 7,
  swipe_velocity: 3,
  promotion_ctr: 0.15,
  hour_of_day: 18,
  is_weekend: 0,
  recent_event_count: 12,
  profile_incomplete: 0,
};

function makeService(overrides: Record<string, any> = {}) {
  const context = {
    userId: 42,
    variant: 'vip',
    score: 0.72,
    phase: 'warm',
    tone: 'soft_sell',
    experimentId: 'promotion-v3-staging',
    assignmentId: 'assignment-1',
    propensity: 0.5,
    features: featureSnapshot,
    position: 3,
    impressionAt: Date.now() - 1000,
  };

  const redis = {
    get: jest.fn(async (_key: string): Promise<string | null> => JSON.stringify(context)),
    set: jest.fn(async (_key: string, _value: string, ..._args: any[]): Promise<string | null> => 'OK'),
    exists: jest.fn(async (_key: string): Promise<number> => 1),
    incr: jest.fn(async (_key: string): Promise<number> => 1),
    expire: jest.fn(async (_key: string, _seconds: number): Promise<number> => 1),
    zadd: jest.fn(async (..._args: any[]): Promise<number> => 1),
    zrem: jest.fn(async (..._args: any[]): Promise<number> => 1),
    zrangebyscore: jest.fn(async (..._args: any[]): Promise<string[]> => []),
  };
  Object.assign(redis, overrides.redis || {});

  const aiFeedbackService = {
    create: jest.fn(async (_payload: any) => ({ id: 1 })),
  };
  const paywallService = {
    adjustWeights: jest.fn(async (..._args: any[]) => undefined),
  };
  const httpPost = jest.fn((_url: string, _body: Record<string, any>) => of({ status: 200 }));
  const httpService = { post: httpPost };
  const configService = {
    get: jest.fn((_key: string, fallback: string) => fallback),
  };
  const featureService = {
    getUserFeatures: jest.fn(async () => featureSnapshot),
  };
  const userEventService = {
    log: jest.fn(async (_payload: any) => undefined),
  };

  const service = new PromotionExposureService(
    redis as any,
    aiFeedbackService as any,
    paywallService as any,
    httpService as any,
    configService as any,
    featureService as any,
    userEventService as any,
  );

  return {
    service,
    redis,
    aiFeedbackService,
    paywallService,
    httpPost,
    featureService,
    userEventService,
    context,
  };
}

describe('PromotionExposureService event attribution', () => {
  it('records an actual impression once and starts the seven-day outcome window', async () => {
    const { service, redis, userEventService } = makeService();
    redis.set
      .mockImplementationOnce(async () => 'OK')   // first impression marker
      .mockImplementationOnce(async () => 'OK')   // refreshed attribution map
      .mockImplementationOnce(async () => 'OK')   // last-shown timestamp
      .mockImplementationOnce(async () => null);  // duplicate impression marker

    const first = await service.trackImpression(42, 'promotion-uuid');
    const second = await service.trackImpression(42, 'promotion-uuid');

    expect(first).toEqual({ success: true, duplicate: false });
    expect(second).toEqual({ success: true, duplicate: true });
    expect(userEventService.log).toHaveBeenCalledWith(expect.objectContaining({
      type: EventType.PROMOTION_SHOWN,
      idempotencyKey: 'promotion:promotion-uuid:shown',
    }));
    expect(redis.incr).toHaveBeenCalledTimes(1);
    expect(redis.zadd).toHaveBeenCalledTimes(1);
  });

  it('records click and dismiss as separate engagement events without purchase labels', async () => {
    const { service, httpPost, userEventService, aiFeedbackService, paywallService } =
      makeService();

    await service.trackClick(42, 'promotion-uuid');
    await service.trackDismiss(42, 'promotion-uuid');

    expect(userEventService.log).toHaveBeenCalledWith(expect.objectContaining({
      type: EventType.PROMOTION_CLICKED,
      idempotencyKey: 'promotion:promotion-uuid:click',
    }));
    expect(userEventService.log).toHaveBeenCalledWith(expect.objectContaining({
      type: EventType.PROMOTION_DISMISSED,
      idempotencyKey: 'promotion:promotion-uuid:dismiss',
    }));
    const feedbackBodies = httpPost.mock.calls.map((call) => call[1]);
    expect(feedbackBodies.map((body) => body.event_type)).toEqual(['click', 'dismiss']);
    expect(feedbackBodies.every((body) => body.label === undefined)).toBe(true);
    expect(aiFeedbackService.create).toHaveBeenCalledTimes(1);
    expect(paywallService.adjustWeights).toHaveBeenCalledTimes(1);
  });

  it('attributes a purchase to the same visible promotion ID and sends a positive outcome', async () => {
    const { service, httpPost, redis, userEventService } = makeService();

    const result = await service.trackConversion(
      42,
      'promotion-uuid',
      'wallet-checkout:test-key',
      'starter_bundle',
    );

    expect(result).toEqual({ success: true, duplicate: false });
    expect(userEventService.log).toHaveBeenCalledWith(expect.objectContaining({
      type: EventType.PROMOTION_CONVERTED,
      metadata: expect.objectContaining({
        promotionId: 'promotion-uuid',
        productCode: 'starter_bundle',
      }),
      idempotencyKey: 'promotion:promotion-uuid:conversion',
    }));
    const feedback = httpPost.mock.calls[0][1];
    expect(feedback.event_type).toBe('conversion');
    expect(feedback.label).toBe(1);
    expect(feedback.promotion_id).toBe('promotion-uuid');
    expect(redis.zrem).toHaveBeenCalledWith('promo:pending-outcomes', 'promotion-uuid');
  });

  it('refuses to attribute the same purchase idempotency key to a second promotion', async () => {
    const { service, redis, userEventService } = makeService();
    redis.get
      .mockImplementationOnce(async () => JSON.stringify({
        userId: 42,
        variant: 'vip',
        features: featureSnapshot,
        impressionAt: Date.now() - 1000,
      }))
      .mockImplementationOnce(async () => 'another-promotion-id');
    redis.set.mockImplementationOnce(async () => null);

    await expect(
      service.trackConversion(
        42,
        'promotion-uuid',
        'wallet-checkout:reused-key',
        'starter_bundle',
      ),
    ).rejects.toThrow('This purchase is already attributed to a different promotion');

    expect(userEventService.log).not.toHaveBeenCalled();
  });

  it('refuses to attribute a purchase outside the seven-day window', async () => {
    const expired = {
      userId: 42,
      variant: 'vip',
      features: featureSnapshot,
      impressionAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    };
    const { service, userEventService } = makeService({
      redis: { get: jest.fn(async () => JSON.stringify(expired)) },
    });

    await expect(
      service.trackConversion(42, 'promotion-uuid', 'purchase-1', 'starter_bundle'),
    ).rejects.toThrow('Promotion attribution window has expired');
    expect(userEventService.log).not.toHaveBeenCalled();
  });

  it('matures an unconverted exposure as a negative outcome only after the window', async () => {
    const { service, redis, httpPost, userEventService } = makeService({
      redis: {
        zrangebyscore: jest.fn(async () => ['promotion-uuid']),
        get: jest.fn()
          .mockImplementationOnce(async () => JSON.stringify({
            userId: 42,
            variant: 'vip',
            features: featureSnapshot,
            experimentId: 'promotion-v3-staging',
            assignmentId: 'assignment-1',
            propensity: 0.5,
          }))
          .mockImplementationOnce(async () => null),
      },
    });

    await service.processMaturePromotionOutcomes();

    expect(userEventService.log).toHaveBeenCalledWith(expect.objectContaining({
      type: EventType.PROMOTION_NON_CONVERTED,
      idempotencyKey: 'promotion:promotion-uuid:non-conversion',
    }));
    const feedback = httpPost.mock.calls[0][1];
    expect(feedback.event_type).toBe('non_conversion');
    expect(feedback.label).toBe(0);
    expect(feedback.outcome_window_complete).toBe(true);
    expect(redis.zrem).toHaveBeenCalledWith('promo:pending-outcomes', 'promotion-uuid');
  });

  it('does not accept events from another user’s promotion ID', async () => {
    const foreign = { userId: 99, variant: 'vip' };
    const { service } = makeService({
      redis: { get: jest.fn(async () => JSON.stringify(foreign)) },
    });

    await expect(service.trackClick(42, 'promotion-uuid')).rejects.toThrow(
      'Promotion does not belong to this user',
    );
  });
});
