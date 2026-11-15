import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as jwt from 'jsonwebtoken';
import { NotificationGateway } from './notification.gateway';

describe('NotificationGateway authenticated Socket.IO contract', () => {
  const originalSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  it('joins only the authenticated user room and records a valid connection', async () => {
    process.env.JWT_SECRET = 'notification-test-secret';
    const userRepo = { update: jest.fn(async () => ({ affected: 1 })) };
    const gateway = new NotificationGateway(userRepo as any);
    const token = jwt.sign({ sub: '42' }, process.env.JWT_SECRET);
    const client = {
      handshake: { auth: { token } },
      join: jest.fn(async () => undefined),
      disconnect: jest.fn(),
      data: {} as Record<string, unknown>,
    };

    await gateway.handleConnection(client as any);

    expect(client.join).toHaveBeenCalledWith('user_42');
    expect(client.data.userId).toBe(42);
    expect(userRepo.update).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ lastActive: expect.any(Date) }),
    );
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('rejects missing or invalid JWT credentials before joining any room', async () => {
    process.env.JWT_SECRET = 'notification-test-secret';
    const userRepo = { update: jest.fn() };
    const gateway = new NotificationGateway(userRepo as any);
    const client = {
      handshake: { auth: {} },
      join: jest.fn(),
      disconnect: jest.fn(),
      data: {},
    };

    await gateway.handleConnection(client as any);

    expect(client.join).not.toHaveBeenCalled();
    expect(userRepo.update).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('checks local room membership and emits to the private recipient room', () => {
    const gateway = new NotificationGateway({ update: jest.fn() } as any);
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    gateway.server = {
      sockets: {
        adapter: {
          rooms: new Map([['user_42', new Set(['socket-1'])]]),
        },
      },
      to,
    } as any;

    expect(gateway.isOnline(42)).toBe(true);
    expect(gateway.isOnline(99)).toBe(false);
    gateway.send(42, { id: 7, message: 'hello' });

    expect(to).toHaveBeenCalledWith('user_42');
    expect(emit).toHaveBeenCalledWith('notification', {
      id: 7,
      message: 'hello',
    });
  });
});
