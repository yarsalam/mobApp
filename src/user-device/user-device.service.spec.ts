import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { UserDeviceService } from './user-device.service';

const deviceDto = {
  userId: 42,
  deviceId: 'device-12345678',
  platform: 'mobile' as const,
  brand: 'Android',
  model: 'Test Device',
  osVersion: '15',
  appVersion: '1.2.3',
  timezone: 'Europe/Berlin',
};

function makeService(existing: any = null) {
  const deviceRepo = {
    findOne: jest.fn(async () => existing),
    create: jest.fn((data: any) => ({...data})),
    save: jest.fn(async (device: any) => device),
  };
  const userRepo = {exist: jest.fn(async () => true)};
  return {
    service: new UserDeviceService(deviceRepo as any, userRepo as any),
    deviceRepo,
    userRepo,
  };
}

describe('UserDeviceService timezone persistence', () => {
  it('creates a device with the timezone sent by an authenticated mobile client', async () => {
    const h = makeService();

    const result = await h.service.createOrUpdateDevice(deviceDto);

    expect(h.userRepo.exist).toHaveBeenCalledWith({where: {id: 42}});
    expect(h.deviceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user: {id: 42},
        deviceId: 'device-12345678',
        timezone: 'Europe/Berlin',
      }),
    );
    expect(result.timezone).toBe('Europe/Berlin');
  });

  it('updates timezone for an existing device after the user logs in again', async () => {
    const existing = {
      id: 9,
      timezone: 'UTC',
      deviceId: 'device-12345678',
    };
    const h = makeService(existing);

    const result = await h.service.createOrUpdateDevice({
      ...deviceDto,
      timezone: 'Asia/Tehran',
    });

    expect(h.deviceRepo.findOne).toHaveBeenCalledWith({
      where: {user: {id: 42}, deviceId: 'device-12345678'},
    });
    expect(result.timezone).toBe('Asia/Tehran');
    expect(h.deviceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({timezone: 'Asia/Tehran'}),
    );
  });

  it('rejects invalid device identifiers before persisting metadata', async () => {
    const h = makeService();

    await expect(
      h.service.createOrUpdateDevice({...deviceDto, deviceId: 'short'}),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.deviceRepo.save).not.toHaveBeenCalled();
  });
});
