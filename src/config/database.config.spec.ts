import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('database configuration safety', () => {
  const keys = ['NODE_ENV', 'DB_SYNC', 'DB_USER', 'DB_PASS', 'DB_NAME', 'DB_HOST', 'DB_PORT'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));

  afterEach(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.resetModules();
  });

  beforeEach(() => {
    process.env.DB_USER = 'test-user';
    process.env.DB_PASS = 'test-password';
    process.env.DB_NAME = 'test-db';
    process.env.DB_HOST = '127.0.0.1';
    process.env.DB_PORT = '3306';
    jest.resetModules();
  });

  it('forbids TypeORM synchronize in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_SYNC = 'true';
    const config = (await import('./database.config')).default;

    expect(() => config()).toThrow(/DB_SYNC must be false/);
  });

  it('keeps production schema synchronization disabled when explicitly false', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_SYNC = 'false';
    const config = (await import('./database.config')).default;

    expect(config().synchronize).toBe(false);
  });

  it('allows explicit schema synchronization only outside production', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_SYNC = 'true';
    const config = (await import('./database.config')).default;

    expect(config().synchronize).toBe(true);
  });
});
