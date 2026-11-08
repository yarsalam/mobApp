import { describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './app.controller';

describe('HealthController', () => {
  it('keeps liveness independent from dependency readiness', () => {
    const controller = new HealthController({} as any, {} as any);
    expect(controller.check()).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
    });
  });

  it('reports ready only when MySQL and Redis both respond', async () => {
    const dataSource = {
      query: jest.fn<() => Promise<any>>().mockResolvedValue([{ result: 1 }]),
    };
    const redis = {
      ping: jest.fn<() => Promise<any>>().mockResolvedValue('PONG'),
    };
    const controller = new HealthController(dataSource as any, redis as any);

    await expect(controller.readiness()).resolves.toEqual({
      status: 'ready',
      checks: { database: 'ok', redis: 'ok' },
      timestamp: expect.any(String),
    });
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
    expect(redis.ping).toHaveBeenCalledTimes(1);
  });

  it('returns 503 without leaking dependency errors when a dependency is unavailable', async () => {
    const dataSource = {
      query: jest.fn<() => Promise<any>>().mockRejectedValue(new Error('private database details')),
    };
    const redis = {
      ping: jest.fn<() => Promise<any>>().mockResolvedValue('PONG'),
    };
    const controller = new HealthController(dataSource as any, redis as any);

    await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(controller.readiness()).rejects.toThrow('not_ready');
  });
});
