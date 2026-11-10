import { describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { CryptoProvider } from './crypto.provider';

describe('CryptoProvider.initiate configuration', () => {
  it('fails before creating a payment when the TRC20 destination is missing', async () => {
    const original = process.env.CRYPTO_WALLET_TRC20;
    delete process.env.CRYPTO_WALLET_TRC20;
    try {
      const repo: any = {
        create: jest.fn((value: unknown) => value),
        save: jest.fn<() => Promise<any>>(),
      };
      const provider = new CryptoProvider(repo, {} as any);

      await expect(provider.initiate(7, 'wallet_charge', 500))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.CRYPTO_WALLET_TRC20;
      else process.env.CRYPTO_WALLET_TRC20 = original;
    }
  });

  it('rejects malformed TRC20 destinations before creating a payment', async () => {
    const original = process.env.CRYPTO_WALLET_TRC20;
    process.env.CRYPTO_WALLET_TRC20 = 'not-a-tron-address';
    try {
      const repo: any = { create: jest.fn(), save: jest.fn() };
      const provider = new CryptoProvider(repo, {} as any);

      await expect(provider.initiate(7, 'wallet_charge', 500))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(repo.create).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.CRYPTO_WALLET_TRC20;
      else process.env.CRYPTO_WALLET_TRC20 = original;
    }
  });
});
