import { describe, expect, it, jest } from '@jest/globals';
import { ReengagementService } from './reengagement.service';

describe('ReengagementService policy', () => {
  const service = Object.create(
    ReengagementService.prototype,
  ) as ReengagementService & Record<string, any>;

  it('uses staged reminders without sending missed stages in a burst', () => {
    expect(service['getStage'](0)).toBeNull();
    expect(service['getStage'](1)).toBe('1d');
    expect(service['getStage'](6)).toBe('1d');
    expect(service['getStage'](7)).toBe('7d');
    expect(service['getStage'](29)).toBe('7d');
    expect(service['getStage'](30)).toBe('30d');
  });

  it('allows in-app scheduling only during known device-local daytime', () => {
    const morningInTehran = new Date('2026-01-01T06:00:00.000Z');
    const earlyInTehran = new Date('2026-01-01T03:00:00.000Z');

    expect(service['isWithinContactHours']('Asia/Tehran', morningInTehran)).toBe(true);
    expect(service['isWithinContactHours']('Asia/Tehran', earlyInTehran)).toBe(false);
    expect(service['isWithinContactHours']('Not/A_Timezone', morningInTehran)).toBe(false);
    expect(service['isWithinContactHours'](undefined, morningInTehran)).toBe(false);
  });

  it('uses only the most recently updated device timezone', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => ({
        id: 2,
        timezone: 'Asia/Tehran',
        updatedAt: new Date('2026-01-01T05:00:00.000Z'),
      })),
    };
    Object.assign(service, {
      deviceRepo: { createQueryBuilder: jest.fn(() => query) },
    });

    const now = new Date('2026-01-01T06:00:00.000Z');
    await expect(service['getEligibleDeviceTimezone'](7, now)).resolves.toBe(
      'Asia/Tehran',
    );
    expect(query.where).toHaveBeenCalledWith('device.userId = :userId', {
      userId: 7,
    });
    expect(query.orderBy).toHaveBeenCalledWith('device.updatedAt', 'DESC');
    expect(query.getOne).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to an older device timezone when the latest device is outside contact hours', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => ({
        id: 2,
        timezone: 'Asia/Tehran',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      })),
    };
    Object.assign(service, {
      deviceRepo: { createQueryBuilder: jest.fn(() => query) },
    });

    const now = new Date('2026-01-01T03:00:00.000Z');
    await expect(service['getEligibleDeviceTimezone'](7, now)).resolves.toBeUndefined();
  });
});
