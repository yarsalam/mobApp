import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
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
