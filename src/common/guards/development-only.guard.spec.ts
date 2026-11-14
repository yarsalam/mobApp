import { NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it } from '@jest/globals';
import { DevelopmentOnlyGuard } from './development-only.guard';

describe('DevelopmentOnlyGuard', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnabled = process.env.ENABLE_DEBUG_ENDPOINTS;
  const guard = new DevelopmentOnlyGuard();

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;

    if (originalEnabled === undefined) delete process.env.ENABLE_DEBUG_ENDPOINTS;
    else process.env.ENABLE_DEBUG_ENDPOINTS = originalEnabled;
  });

  it('denies by default when runtime and opt-in are absent', () => {
    delete process.env.NODE_ENV;
    delete process.env.ENABLE_DEBUG_ENDPOINTS;

    expect(() => guard.canActivate({} as any)).toThrow(NotFoundException);
  });

  it('denies production even when explicitly enabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_DEBUG_ENDPOINTS = 'true';

    expect(() => guard.canActivate({} as any)).toThrow(NotFoundException);
  });

  it('denies unknown runtime modes even when explicitly enabled', () => {
    process.env.NODE_ENV = 'staging';
    process.env.ENABLE_DEBUG_ENDPOINTS = 'true';

    expect(() => guard.canActivate({} as any)).toThrow(NotFoundException);
  });

  it('denies development unless explicitly enabled', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ENABLE_DEBUG_ENDPOINTS;

    expect(() => guard.canActivate({} as any)).toThrow(NotFoundException);
  });

  it('allows explicitly enabled development and test runtimes', () => {
    process.env.ENABLE_DEBUG_ENDPOINTS = 'true';

    process.env.NODE_ENV = 'development';
    expect(guard.canActivate({} as any)).toBe(true);

    process.env.NODE_ENV = 'test';
    expect(guard.canActivate({} as any)).toBe(true);
  });
});
