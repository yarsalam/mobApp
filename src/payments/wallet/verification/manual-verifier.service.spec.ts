import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ManualVerifierService } from './manual-verifier.service';

describe('ManualVerifierService.reject', () => {
  function harness(payment: any = {
    id: 44,
    status: 'pending',
    method: 'manual_card',
    metadata: { source: 'card-transfer' },
  }, updateAffected = 1, latest: any = payment) {
    const paymentRepo: any = {
      findOne: jest.fn<() => Promise<any>>()
        .mockResolvedValueOnce(payment)
        .mockResolvedValue(latest),
      update: jest.fn<() => Promise<any>>().mockResolvedValue({ affected: updateAffected }),
    };
    const wallet: any = {};
    const events: any = {};
    return { service: new ManualVerifierService(paymentRepo, wallet, events), paymentRepo };
  }

  it('rejects only a pending manual-card payment using compare-and-set criteria', async () => {
    const h = harness();

    await h.service.reject(44, 'duplicate receipt');

    expect(h.paymentRepo.update).toHaveBeenCalledWith(
      { id: 44, status: 'pending', method: 'manual_card' },
      expect.objectContaining({
        status: 'failed',
        metadata: expect.objectContaining({ rejectReason: 'duplicate receipt' }),
      }),
    );
  });

  it('does not overwrite a payment confirmed after the initial read', async () => {
    const h = harness(
      { id: 44, status: 'pending', method: 'manual_card', metadata: {} },
      0,
      { id: 44, status: 'paid', method: 'manual_card' },
    );

    await expect(h.service.reject(44, 'stale decision'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(h.paymentRepo.update).toHaveBeenCalledTimes(1);
  });

  it('returns not found when payment does not exist', async () => {
    const h = harness(null, 0, null);

    await expect(h.service.reject(44, 'missing'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(h.paymentRepo.update).not.toHaveBeenCalled();
  });
});
