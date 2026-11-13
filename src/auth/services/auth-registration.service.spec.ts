import { describe, expect, it, jest } from '@jest/globals';
import { AuthRegistrationService } from './auth-registration.service';
import { EventType } from '../../user-event/type/event-type.enum';

function makeService(user: any) {
  const usersService: any = {
    findById: jest.fn(async () => user),
    update: jest.fn(async (_id: number, patch: any) => ({...user, ...patch})),
  };
  const userEventService: any = {
    log: jest.fn(async () => undefined),
  };
  const service = new AuthRegistrationService(
    usersService,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    userEventService,
    {} as any,
  );
  return {service, usersService, userEventService};
}

describe('AuthRegistrationService acquisition touch sync', () => {
  const firstTouch = {
    source: 'google_organic',
    medium: 'organic',
    campaign: 'trust',
    campaignId: 'gsc-2026',
    content: null,
    term: 'security',
    landingPage: 'https://yarsalam.top/trust',
    referrer: 'google.com',
    referralCode: null,
    capturedAt: '2026-10-01T10:00:00.000Z',
  };

  it('preserves first touch, records last touch as an idempotent event and updates only last touch', async () => {
    const user = {
      id: 42,
      acquisitionSource: 'google_organic',
      acquisitionKeyword: 'security',
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
      metadata: {
        acquisition: {
          firstTouch,
          firstTouchAt: firstTouch.capturedAt,
          lastTouch: firstTouch,
        },
      },
    };
    const h = makeService(user);
    const lastTouch = {
      source: 'instagram',
      medium: 'social',
      campaign: 'return',
      campaignId: 'ig-return-01',
      capturedAt: '2026-11-13T15:00:00.000Z',
      landingPage: 'https://yarsalam.top/safety?private=discarded',
    };

    const result = await h.service.updateAcquisitionLastTouch(42, lastTouch as any);

    expect(result).toEqual({success: true, unchanged: false});
    expect(h.usersService.update).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        metadata: expect.objectContaining({
          acquisition: expect.objectContaining({
            firstTouch,
            firstTouchAt: firstTouch.capturedAt,
            lastTouch: expect.objectContaining({
              source: 'instagram',
              campaignId: 'ig-return-01',
              landingPage: 'https://yarsalam.top/safety',
            }),
          }),
        }),
      }),
    );
    expect(h.userEventService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        type: EventType.LOGIN,
        metadata: expect.objectContaining({
          kind: 'acquisition_touch',
          via: 'acquisition_touch_sync',
          acquisitionTouch: expect.objectContaining({source: 'instagram'}),
        }),
        idempotencyKey: expect.stringMatching(/^acquisition:last_touch:/),
      }),
    );
  });

  it('does not rewrite the user when the same last touch is synced again', async () => {
    const lastTouch = {
      source: 'instagram',
      medium: 'social',
      campaign: 'return',
      campaignId: 'ig-return-01',
      content: null,
      term: null,
      landingPage: 'https://yarsalam.top/safety',
      referrer: null,
      referralCode: null,
      capturedAt: '2026-11-13T15:00:00.000Z',
      confidence: 'explicit_utm',
    };
    const h = makeService({
      id: 42,
      acquisitionSource: 'google_organic',
      acquisitionKeyword: 'security',
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
      metadata: {
        acquisition: {
          firstTouch,
          firstTouchAt: firstTouch.capturedAt,
          lastTouch,
        },
      },
    });

    const result = await h.service.updateAcquisitionLastTouch(42, lastTouch as any);

    expect(result).toEqual({success: true, unchanged: true});
    expect(h.usersService.update).not.toHaveBeenCalled();
    // The event receipt is still submitted; its stable key makes it idempotent.
    expect(h.userEventService.log).toHaveBeenCalledTimes(1);
  });
});
