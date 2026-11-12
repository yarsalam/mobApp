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
  session_depth: 12,
  profile_incomplete: 0,
};

function makeService(overrides: Record<string, any> = {}) {
  const context = {
    userId: 42,
    variant: 'vip',
    score: 0.72,
    phase: 'warm',
    tone: 'soft_sell',
    experimentId: 'promotion-v2-staging',
    assignmentId: 'assignment-1',
    propensity: 0.5,
    features: featureSnapshot,
    position: 3,
    impressionAt: Date.now() - 1000,
  };
  const redis = {
    get: jest.fn().mockResolvedValue(JSON.stringify(context)),
    set: jest.fn().mockResolvedValue('OK'),
    exists: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    zadd: jest.fn().mockResolvedValue(1),
    zrem: jest.fn().mockResolvedValue(1),
    zrangebyscore: jest.fn().mockResolvedValue([]),
    ...overrides.redis,
  };
  const aiFeedbackService = {
    create: jest.fn().mockResolvedValue({ id: 1 }),
  };
  const paywallService = {
    adjustWeights: jest.fn().mockResolvedValue(undefined),
  };
  const httpService = {
    post: jest.fn().mockReturnValue(of({ status: 200 })),
  };
  const configService = {
    get: jest.fn((_key: string, fallback: string) => fallback),
  };
  const featureService = {
    getUserFeatures: jest.fn().mockResolvedValue(featureSnapshot),
  };
  const userEventService = {
    log: jest.fn().mockResolvedValue(undefined),
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
    httpService,
    featureService,
    userEventService,
    context,
  };
}

describe('PromotionExposureService event attribution', () => {
  it('records an actual impression once and starts the seven-day outcome window', async () => {
    const { service, redis, userEventService } = makeService({
      redis: {
        set: jest.fn()
          .mockResolvedValueOnce('OK')   // first impression marker
          .mockResolvedValueOnce('OK'),  // refreshed attribution map
      },
    });

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

  it('records click and dismiss as separate non-conversion engagement events', async () => {
    const {
      service,
      httpService,
      userEventService,
      aiFeedbackService,
      paywallService,
    } = makeService();

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
    const feedbackBodies = httpService.post.mock.calls.map((call: any[]) => call[1]);
    expect(feedbackBodies.map((body: any) => body.event_type)).toEqual(['click', 'dismiss']);
    expect(feedbackBodies.every((body: any) => body.label === undefined)).toBe(true);
    expect(aiFeedbackService.create).toHaveBeenCalledTimes(1);
    expect(paywallService.adjustWeights).toHaveBeenCalledTimes(1);
  });

  it('attributes a purchase to the same visible promotion ID and sends a positive outcome', async () => {
    const { service, httpService, redis, userEventService } = makeService();

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
    const feedback = httpService.post.mock.calls[0][1];
    expect(feedback.event_type).toBe('conversion');
    expect(feedback.label).toBe(1);
    expect(feedback.promotion_id).toBe('promotion-uuid');
    expect(redis.zrem).toHaveBeenCalledWith('promo:pending-outcomes', 'promotion-uuid');
  });

  it('refuses to attribute the same purchase idempotency key to a second promotion', async () => {
    const { service, redis, userEventService } = makeService();
    redis.set.mockResolvedValue(null);
    redis.get
      .mockResolvedValueOnce(JSON.stringify({
        userId: 42,
        variant: 'vip',
        features: featureSnapshot,
        impressionAt: Date.now() - 1000,
      }))
      .mockResolvedValueOnce('another-promotion-id');

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
      redis: { get: jest.fn().mockResolvedValue(JSON.stringify(expired)) },
    });

    await expect(
      service.trackConversion(42, 'promotion-uuid', 'purchase-1', 'starter_bundle'),
    ).rejects.toThrow('Promotion attribution window has expired');
    expect(userEventService.log).not.toHaveBeenCalled();
  });

  it('matures an unconverted exposure as a negative outcome only after the window', async () => {
    const { service, redis, httpService, userEventService } = makeService({
      redis: {
        zrangebyscore: jest.fn().mockResolvedValue(['promotion-uuid']),
        get: jest.fn()
          .mockResolvedValueOnce(JSON.stringify({
            userId: 42,
            variant: 'vip',
            features: featureSnapshot,
            experimentId: 'promotion-v2-staging',
            assignmentId: 'assignment-1',
            propensity: 0.5,
          }))
          .mockResolvedValueOnce(null),
      },
    });

    await service.processMaturePromotionOutcomes();

    expect(userEventService.log).toHaveBeenCalledWith(expect.objectContaining({
      type: EventType.PROMOTION_NON_CONVERTED,
      idempotencyKey: 'promotion:promotion-uuid:non-conversion',
    }));
    const feedback = httpService.post.mock.calls[0][1];
    expect(feedback.event_type).toBe('non_conversion');
    expect(feedback.label).toBe(0);
    expect(feedback.outcome_window_complete).toBe(true);
    expect(redis.zrem).toHaveBeenCalledWith('promo:pending-outcomes', 'promotion-uuid');
  });

  it('does not accept events from another user’s promotion ID', async () => {
    const foreign = { userId: 99, variant: 'vip' };
    const { service } = makeService({
      redis: { get: jest.fn().mockResolvedValue(JSON.stringify(foreign)) },
    });

    await expect(service.trackClick(42, 'promotion-uuid')).rejects.toThrow(
      'Promotion does not belong to this user',
    );
  });
});
