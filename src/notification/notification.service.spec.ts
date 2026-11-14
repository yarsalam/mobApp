import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
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

  it('scopes inbox listing and read/click mutations to the authenticated owner', async () => {
    const repository = {
      create: jest.fn(),
      save: jest.fn(),
      count: jest.fn(async () => 0),
      find: jest.fn(async () => []),
      update: jest.fn(async () => ({ affected: 0 })),
    };
    const service = new NotificationService(
      repository as any,
      { dispatch: jest.fn() } as any,
    );

    await service.getUserNotifications(23);
    expect(repository.find).toHaveBeenCalledWith({
      where: { user_id: 23 },
      order: { created_at: 'DESC' },
      take: 500,
    });

    await expect(service.markAsRead(18, 23)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.update).toHaveBeenNthCalledWith(
      1,
      { id: 18, user_id: 23 },
      { is_read: true },
    );

    await expect(service.markClicked(18, 23)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.update).toHaveBeenNthCalledWith(
      2,
      { id: 18, user_id: 23 },
      { clicked: true },
    );
  });

  it('returns the recipient unread count for pending reconnect sync', async () => {
    const repository = {
      create: jest.fn(),
      save: jest.fn(),
      count: jest.fn(async () => 4),
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
