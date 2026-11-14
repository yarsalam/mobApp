import { describe, expect, it, jest } from '@jest/globals';
import { NotificationService } from './notification.service';
import { NotificationType } from './entities/notification.entity';

describe('NotificationService offline inbox', () => {
  it('persists a notification before attempting Socket.IO delivery', async () => {
    const saved = {
      id: 18,
      user_id: 23,
      type: NotificationType.MESSAGE,
      message: 'پیام جدید',
    };
    const events: string[] = [];
    const repository = {
      create: jest.fn().mockReturnValue(saved),
      save: jest.fn(async () => {
        events.push('saved');
        return saved;
      }),
      count: jest.fn(),
    };
    const orchestrator = {
      dispatch: jest.fn(async () => {
        events.push('dispatch');
      }),
    };
    const service = new NotificationService(
      repository as any,
      orchestrator as any,
    );

    await service.createNotification({
      user_id: 23,
      type: NotificationType.MESSAGE,
      message: 'پیام جدید',
    });

    expect(events).toEqual(['saved', 'dispatch']);
    expect(repository.save).toHaveBeenCalledWith(saved);
    expect(orchestrator.dispatch).toHaveBeenCalledWith(saved);
  });

  it('returns the recipient unread count for pending reconnect sync', async () => {
    const repository = {
      create: jest.fn(),
      save: jest.fn(),
      count: jest.fn().mockResolvedValue(4),
    };
    const service = new NotificationService(
      repository as any,
      { dispatch: jest.fn() } as any,
    );

    await expect(service.getPendingCount(23)).resolves.toEqual({
      hasUnread: true,
      count: 4,
    });
    expect(repository.count).toHaveBeenCalledWith({
      where: { user_id: 23, is_read: false },
    });
  });
});
