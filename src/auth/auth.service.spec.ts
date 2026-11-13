import { describe, expect, it, jest } from '@jest/globals';
import { AuthService } from './auth.service';

describe('AuthService acquisition touch delegation', () => {
  it('delegates last-touch updates to the registration service', async () => {
    const registration = {
      updateAcquisitionLastTouch: jest.fn(async () => ({
        success: true,
        unchanged: false,
      })),
    };
    const service = new AuthService(
      registration as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const touch = {
      source: 'instagram',
      medium: 'social',
      campaign: 'trust',
      campaignId: 'ig-2026-11',
      capturedAt: '2026-11-13T15:00:00.000Z',
    };

    await expect(service.updateAcquisitionLastTouch(42, touch)).resolves.toEqual({
      success: true,
      unchanged: false,
    });
    expect(registration.updateAcquisitionLastTouch).toHaveBeenCalledWith(42, touch);
  });
});
