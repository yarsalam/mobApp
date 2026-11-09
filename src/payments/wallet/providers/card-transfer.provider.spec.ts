import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CardTransferProvider } from './card-transfer.provider';

describe('CardTransferProvider.submitProof', () => {
  function harness(payment: any = {
    id: 44,
    userId: 7,
    status: 'pending',
    method: 'manual_card',
    metadata: { cardNumber: '****' },
  }) {
    const paymentRepo: any = {
      findOne: jest.fn<() => Promise<any>>().mockResolvedValue(payment),
      update: jest.fn<() => Promise<any>>().mockResolvedValue({ affected: 1 }),
    };
    const events: any = { log: jest.fn<() => Promise<any>>().mockResolvedValue(undefined) };
    return { provider: new CardTransferProvider(paymentRepo, events), paymentRepo };
  }

  it('only updates a pending manual payment belonging to the authenticated user', async () => {
    const h = harness();

    await h.provider.submitProof(44, 7, '  uploads/proof-44.jpg  ');

    expect(h.paymentRepo.findOne).toHaveBeenCalledWith({
      where: { id: 44, userId: 7, status: 'pending', method: 'manual_card' },
    });
    expect(h.paymentRepo.update).toHaveBeenCalledWith(
      { id: 44, userId: 7, status: 'pending', method: 'manual_card' },
      expect.objectContaining({
        proofUrl: 'uploads/proof-44.jpg',
        metadata: expect.objectContaining({ cardNumber: '****' }),
      }),
    );
  });

  it('does not disclose or update another user payment', async () => {
    const h = harness(null);

    await expect(h.provider.submitProof(44, 8, 'uploads/proof-44.jpg'))
      .rejects.toBeInstanceOf(NotFoundException);

    expect(h.paymentRepo.update).not.toHaveBeenCalled();
  });

  it('does not overwrite a payment that left pending during upload', async () => {
    const h = harness();
    h.paymentRepo.update.mockResolvedValue({ affected: 0 });

    await expect(h.provider.submitProof(44, 7, 'uploads/proof-44.jpg'))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});


describe('CardTransferProvider.initiate configuration', () => {
  it('fails before creating a payment when the destination card is missing', async () => {
    const original = process.env.CARD_TRANSFER_NUMBER;
    delete process.env.CARD_TRANSFER_NUMBER;
    try {
      const repo: any = {
        create: jest.fn((value: unknown) => value),
        save: jest.fn<() => Promise<any>>(),
      };
      const events: any = { log: jest.fn<() => Promise<any>>() };
      const provider = new CardTransferProvider(repo, events);

      await expect(provider.initiate(7, 'wallet_charge', 100_000))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.CARD_TRANSFER_NUMBER;
      else process.env.CARD_TRANSFER_NUMBER = original;
    }
  });

  it('rejects non-positive or fractional deposit amounts', async () => {
    const original = process.env.CARD_TRANSFER_NUMBER;
    process.env.CARD_TRANSFER_NUMBER = '1234567812345678';
    try {
      const repo: any = { create: jest.fn(), save: jest.fn() };
      const provider = new CardTransferProvider(repo, {} as any);

      await expect(provider.initiate(7, 'wallet_charge', 0))
        .rejects.toThrow(/positive safe integer/);
      expect(repo.create).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.CARD_TRANSFER_NUMBER;
      else process.env.CARD_TRANSFER_NUMBER = original;
    }
  });
});
