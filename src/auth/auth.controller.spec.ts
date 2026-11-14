import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { AuthController } from './auth.controller';

function makeController(options?: {
  nodeEnv?: string;
  enabled?: string;
}) {
  const authService = {
    simLogin: jest
      .fn<() => Promise<{ id: number; phone: string }>>()
      .mockResolvedValue({ id: 42, phone: '09123456789' }),
  };
  const jwtService = {
    sign: jest.fn().mockReturnValue('staging-only-test-token'),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'NODE_ENV') return options?.nodeEnv ?? 'development';
      if (key === 'ENABLE_SIM_LOGIN') return options?.enabled;
      return undefined;
    }),
  };

  const controller = new AuthController(
    authService as any,
    {} as any,
    {} as any,
    jwtService as any,
    configService as any,
  );

  return { controller, authService, jwtService };
}

describe('AuthController sim-login security gate', () => {
  it('is disabled by default in non-production environments', async () => {
    const { controller, authService } = makeController();

    await expect(
      controller.simLogin({ phone: '09123456789' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(authService.simLogin).not.toHaveBeenCalled();
  });

  it('remains unavailable in production even when the opt-in flag is true', async () => {
    const { controller, authService } = makeController({
      nodeEnv: 'production',
      enabled: 'true',
    });

    await expect(
      controller.simLogin({ phone: '09123456789' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(authService.simLogin).not.toHaveBeenCalled();
  });

  it('rejects invalid phone numbers before creating or looking up a user', async () => {
    const { controller, authService } = makeController({ enabled: 'true' });

    await expect(
      controller.simLogin({ phone: 'not-a-phone' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(authService.simLogin).not.toHaveBeenCalled();
  });

  it('rejects unsupported gender values', async () => {
    const { controller, authService } = makeController({ enabled: 'true' });

    await expect(
      controller.simLogin({ phone: '09123456789', gender: 'admin' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(authService.simLogin).not.toHaveBeenCalled();
  });

  it('issues a synthetic token only with explicit non-production opt-in', async () => {
    const { controller, authService, jwtService } = makeController({
      nodeEnv: 'development',
      enabled: 'true',
    });

    await expect(
      controller.simLogin({ phone: '09123456789', gender: 'women' }),
    ).resolves.toEqual({ token: 'staging-only-test-token' });
    expect(authService.simLogin).toHaveBeenCalledWith('09123456789', 'women');
    expect(jwtService.sign).toHaveBeenCalledWith(
      { sub: 42, phone: '09123456789' },
      { expiresIn: '30d' },
    );
  });
});
