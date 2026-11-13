import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { AdminApiRevenueController } from './admin-api-revenue.controller';

function makeController() {
  const pricingExperiments = {
    getExperimentReport: jest.fn(async (experimentId: string, days: number) => ({
      experimentId,
      periodDays: days,
      variants: [],
    })),
    getAdminSettings: jest.fn(async (experimentId: string) => ({
      experimentId,
      enabled: false,
      discountBps: 1000,
      treatmentRateBps: 2000,
      maxDiscountBudgetRials: 200_000,
      endsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      secretConfigured: false,
      budgetCapRials: 200_000,
      spentDiscountRials: 0,
      reservedDiscountRials: 0,
      remainingBudgetRials: 200_000,
      budgetExhausted: false,
    })),
    updateAdminSettings: jest.fn(async (experimentId: string, input: any) => ({
      experimentId,
      ...input,
    })),
  };
  const controller = new AdminApiRevenueController(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    pricingExperiments as any,
  );
  return { controller, pricingExperiments };
}

describe('AdminApiRevenueController pricing experiment', () => {
  it('returns the report with a bounded window and default of 90 days', async () => {
    const h = makeController();

    await expect(
      h.controller.pricingExperimentReport('pricing-first-purchase-v1'),
    ).resolves.toMatchObject({
      experimentId: 'pricing-first-purchase-v1',
      periodDays: 90,
    });
    await h.controller.pricingExperimentReport('pricing-first-purchase-v1', '30');

    expect(h.pricingExperiments.getExperimentReport).toHaveBeenNthCalledWith(
      1,
      'pricing-first-purchase-v1',
      90,
    );
    expect(h.pricingExperiments.getExperimentReport).toHaveBeenNthCalledWith(
      2,
      'pricing-first-purchase-v1',
      30,
    );
  });

  it.each(['bad id', '../other', ''])(
    'rejects an invalid experiment ID: %s',
    async experimentId => {
      const h = makeController();
      await expect(
        h.controller.pricingExperimentReport(experimentId),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.pricingExperiments.getExperimentReport).not.toHaveBeenCalled();
    },
  );

  it.each(['0', '3651', '1.5', 'invalid'])(
    'rejects an invalid report range: %s',
    async days => {
      const h = makeController();
      await expect(
        h.controller.pricingExperimentReport('pricing-first-purchase-v1', days),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.pricingExperiments.getExperimentReport).not.toHaveBeenCalled();
    },
  );

  it('returns dynamic settings without disclosing the signing key', async () => {
    const h = makeController();
    const settings = await h.controller.pricingExperimentSettings(
      'pricing-first-purchase-v1',
    );
    expect(settings).toMatchObject({
      experimentId: 'pricing-first-purchase-v1',
      enabled: false,
      maxDiscountBudgetRials: 200_000,
      remainingBudgetRials: 200_000,
      secretConfigured: false,
    });
    expect(JSON.stringify(settings)).not.toContain('secret');
    expect(h.pricingExperiments.getAdminSettings).toHaveBeenCalledWith(
      'pricing-first-purchase-v1',
    );
  });

  it('forwards the runtime settings patch to the pricing service', async () => {
    const h = makeController();
    const input = {
      enabled: false,
      discountBps: 1000,
      treatmentRateBps: 2000,
      maxDiscountBudgetRials: 200_000,
      endsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    };

    await expect(
      h.controller.updatePricingExperimentSettings(
        'pricing-first-purchase-v1',
        input,
      ),
    ).resolves.toMatchObject({
      experimentId: 'pricing-first-purchase-v1',
      ...input,
    });
    expect(h.pricingExperiments.updateAdminSettings).toHaveBeenCalledWith(
      'pricing-first-purchase-v1',
      input,
    );
  });
});
