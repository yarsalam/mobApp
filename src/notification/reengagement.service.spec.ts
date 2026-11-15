import { describe, expect, it, jest } from '@jest/globals';
import { ReengagementService } from './reengagement.service';

describe('ReengagementService policy', () => {
  const service = Object.create(
    ReengagementService.prototype,
  ) as ReengagementService & Record<string, any>;

  it('keeps the scheduler disabled until explicitly enabled after migration', async () => {
    const previous = process.env.ENABLE_REENGAGEMENT_NOTIFICATIONS;
    process.env.ENABLE_REENGAGEMENT_NOTIFICATIONS = 'false';
    const createQueryBuilder = jest.fn();
    Object.assign(service, {userRepo: {createQueryBuilder}});

    await service.scheduleReengagement();

    expect(createQueryBuilder).not.toHaveBeenCalled();
    if (previous === undefined) delete process.env.ENABLE_REENGAGEMENT_NOTIFICATIONS;
    else process.env.ENABLE_REENGAGEMENT_NOTIFICATIONS = previous;
  });

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

  it('rotates the inactive-user scan cursor instead of starving later accounts', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => []),
    };
    const redis = {
      get: jest.fn(async () => '500'),
      set: jest.fn(async () => 'OK'),
    };
    Object.assign(service, {
      userRepo: { createQueryBuilder: jest.fn(() => query) },
      redis,
    });

    await service.scheduleReengagement();

    expect(query.andWhere).toHaveBeenCalledWith('user.id > :cursorId', {
      cursorId: 500,
    });
    expect(query.orderBy).toHaveBeenCalledWith('user.id', 'ASC');
    expect(redis.set).toHaveBeenCalledWith('reengagement:scan-cursor', '0');
  });

  it('uses stored device timezone without requiring a remote-push token', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => [
        { id: 2, timezone: 'Asia/Tehran', updatedAt: new Date() },
      ]),
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
    expect(query.select).toHaveBeenCalledWith([
      'device.id',
      'device.timezone',
      'device.updatedAt',
    ]);
  });
});
