import { describe, expect, it, jest } from '@jest/globals';
import { NotificationOrchestrator } from './orchestrator.notification';
import { NotificationType } from './entities/notification.entity';

describe('NotificationOrchestrator (Socket.IO only)', () => {
  const notification = {
    id: 41,
    user_id: 7,
    type: NotificationType.SYSTEM,
    message: 'آزمایش اعلان',
    related_id: undefined,
    created_at: new Date('2026-11-14T10:00:00.000Z'),
    is_read: false,
  };

  it('leaves offline notifications persisted without attempting external delivery', async () => {
    const gateway = {
      isOnline: jest.fn().mockReturnValue(false),
      send: jest.fn(),
    };
    const repository = { update: jest.fn() };
    const orchestrator = new NotificationOrchestrator(
      gateway as any,
      repository as any,
    );

    await orchestrator.dispatch(notification as any);

    expect(gateway.isOnline).toHaveBeenCalledWith(7);
    expect(gateway.send).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('sends an online notification only to the recipient room', async () => {
    const gateway = {
      isOnline: jest.fn().mockReturnValue(true),
      send: jest.fn(),
    };
    const repository = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const orchestrator = new NotificationOrchestrator(
      gateway as any,
      repository as any,
    );

    await orchestrator.dispatch(notification as any);

    expect(gateway.send).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ id: 41, message: 'آزمایش اعلان' }),
    );
    expect(repository.update).toHaveBeenCalledWith(41, { delivered: true });
  });
});
