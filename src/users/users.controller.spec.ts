import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController account actions', () => {
  const usersService = {
    suspendAccount: jest.fn(),
    resignAccount: jest.fn(),
    update: jest.fn(),
  } as unknown as UsersService;

  const controller = new UsersController(usersService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects profile updates targeting another account', async () => {
    expect(() =>
      controller.update(99, {} as never, { user: { sub: '42' } }),
    ).toThrow(ForbiddenException);

    expect(usersService.update).not.toHaveBeenCalled();
  });

  it('allows a profile update only for the authenticated account', async () => {
    const dto = {} as never;
    await controller.update(42, dto, { user: { sub: '42' } });
    expect(usersService.update).toHaveBeenCalledWith(42, dto);
  });

  it('derives self-suspension target from the authenticated JWT subject', async () => {
    const req = { user: { sub: '42' } };

    await controller.suspendMyAccount(req);

    expect(usersService.suspendAccount).toHaveBeenCalledWith(42);
  });

  it('derives self-resignation target from the authenticated JWT subject', async () => {
    const req = { user: { sub: 42 } };

    await controller.resignMyAccount(req);

    expect(usersService.resignAccount).toHaveBeenCalledWith(42);
  });

  it('rejects a legacy suspend request targeting another account', async () => {
    await expect(
      controller.suspendAccount(99, { user: { sub: '42' } }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(usersService.suspendAccount).not.toHaveBeenCalled();
  });

  it('rejects a legacy resign request targeting another account', async () => {
    await expect(
      controller.resignAccount(99, { user: { sub: '42' } }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(usersService.resignAccount).not.toHaveBeenCalled();
  });

  it('rejects missing or invalid authenticated user IDs', async () => {
    await expect(
      controller.suspendMyAccount({ user: { sub: 'not-a-user-id' } }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(usersService.suspendAccount).not.toHaveBeenCalled();
  });
});
