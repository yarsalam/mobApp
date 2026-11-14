import { describe, expect, it, jest } from '@jest/globals';
import { ReengagementService } from './reengagement.service';

describe('ReengagementService policy', () => {
  const service = Object.create(
    ReengagementService.prototype,
  ) as ReengagementService & Record<string, any>;

  it('uses a staged schedule and never sends multiple catch-up stages at once', () => {
    expect(service['getStage'](0)).toBeNull();
    expect(service['getStage'](1)).toBe('1d');
    expect(service['getStage'](6)).toBe('1d');
    expect(service['getStage'](7)).toBe('7d');
    expect(service['getStage'](29)).toBe('7d');
    expect(service['getStage'](30)).toBe('30d');
  });

  it('allows sends only during local daytime and fails closed for unknown timezones', () => {
    const morningInTehran = new Date('2026-01-01T06:00:00.000Z');
    const earlyInTehran = new Date('2026-01-01T03:00:00.000Z');

    expect(service['isWithinContactHours']('Asia/Tehran', morningInTehran)).toBe(true);
    expect(service['isWithinContactHours']('Asia/Tehran', earlyInTehran)).toBe(false);
    expect(service['isWithinContactHours']('Not/A_Timezone', morningInTehran)).toBe(false);
    expect(service['isWithinContactHours'](undefined, morningInTehran)).toBe(false);
  });

  it('does not query or schedule recipients before FCM is configured', async () => {
    const userRepo = { createQueryBuilder: jest.fn() };
    const pushChannel = { isConfigured: jest.fn().mockReturnValue(false) };
    Object.assign(service, {
      userRepo,
      pushChannel,
      logger: { debug: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });

    await service.scheduleReengagement();

    expect(userRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
