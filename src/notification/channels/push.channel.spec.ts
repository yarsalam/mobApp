import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { generateKeyPairSync } from 'crypto';
import { PushChannel } from './push.channel';
import { NotificationType } from '../entities/notification.entity';

const originalServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const originalFetch = global.fetch;

function makeRepo(devices: Array<Record<string, unknown>> = []) {
  const query = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn<() => Promise<Array<Record<string, unknown>>>>().mockResolvedValue(devices),
  };
  return {
    repo: {
      createQueryBuilder: jest.fn(() => query),
      update: jest.fn<(id: number, patch: Record<string, unknown>) => Promise<{ affected: number }>>().mockResolvedValue({ affected: 1 }),
    },
    query,
  };
}

afterEach(() => {
  if (originalServiceAccount === undefined) {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  } else {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = originalServiceAccount;
  }
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('PushChannel FCM HTTP v1 delivery', () => {
  it('fails closed when no Firebase service account is configured', async () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const { repo } = makeRepo([{ id: 3, pushToken: 'token' }]);
    const channel = new PushChannel(repo as any);

    await expect(
      channel.send({
        id: 12,
        user_id: 7,
        type: NotificationType.SYSTEM,
        message: 'یادآوری',
      } as any),
    ).resolves.toBe(false);

    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    expect(global.fetch).toBe(originalFetch);
  });

  it('sends to enabled devices using an OAuth access token without exposing the token in logs', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: 'yarsalam-test',
      client_email: 'firebase-sender@example.invalid',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });

    const { repo, query } = makeRepo([
      { id: 3, pushToken: 'fcm-device-token', timezone: 'Asia/Tokyo' },
    ]);
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'oauth-access-token', expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'projects/yarsalam-test/messages/123' }),
      } as Response) as typeof fetch;

    const channel = new PushChannel(repo as any);
    const result = await channel.send({
      id: 12,
      user_id: 7,
      type: NotificationType.SYSTEM,
      message: 'اعلان آزمایشی',
    } as any);

    expect(result).toBe(true);
    expect(query.addSelect).toHaveBeenCalledWith('device.pushToken');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const fcmCall = (global.fetch as any).mock.calls[1];
    expect(String(fcmCall[0])).toContain('/v1/projects/yarsalam-test/messages:send');
    expect(JSON.parse(fcmCall[1].body).message.token).toBe('fcm-device-token');
    expect(JSON.parse(fcmCall[1].body).message.notification.body).toBe('اعلان آزمایشی');
  });

  it('disables only tokens that FCM explicitly reports as unregistered', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: 'yarsalam-test',
      client_email: 'firebase-sender@example.invalid',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });

    const { repo } = makeRepo([{ id: 9, pushToken: 'expired-token', timezone: 'UTC' }]);
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'oauth-access-token', expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          error: { details: [{ errorCode: 'UNREGISTERED' }] },
        }),
      } as Response) as typeof fetch;

    const channel = new PushChannel(repo as any);
    await expect(
      channel.send({
        id: 13,
        user_id: 7,
        type: NotificationType.SYSTEM,
        message: 'اعلان',
      } as any),
    ).resolves.toBe(false);

    expect(repo.update).toHaveBeenCalledWith(9, {
      pushToken: null,
      pushEnabled: false,
    });
  });
});
