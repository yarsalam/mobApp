import { BadRequestException } from '@nestjs/common';
import { ProductController } from './product.controller';

describe('ProductController pricing experiment routes', () => {
  function makeController() {
    const bundles = {
      find: jest.fn(async () => []),
    };
    const pricingExperiment = {
      getQuote: jest.fn(async () => ({
        bundleCode: 'vip-month',
        basePriceRials: 100000,
        payablePriceRials: 90000,
        currency: 'IRT',
        eligibleForExperiment: true,
        quoteId: 'signed-quote',
      })),
      recordExposure: jest.fn(async () => ({ success: true })),
    };
    return {
      controller: new ProductController(bundles as any, pricingExperiment as any),
      bundles,
      pricingExperiment,
    };
  }

  it('returns a personalized quote only for the authenticated user and selected bundle', async () => {
    const h = makeController();

    await expect(
      h.controller.getPricingQuote(42, 'vip-month'),
    ).resolves.toMatchObject({
      bundleCode: 'vip-month',
      basePriceRials: 100000,
      payablePriceRials: 90000,
      quoteId: 'signed-quote',
    });
    expect(h.pricingExperiment.getQuote).toHaveBeenCalledWith(42, 'vip-month');
  });

  it('records exposure only when the client explicitly confirms the displayed quote', async () => {
    const h = makeController();

    await expect(
      h.controller.recordPricingExposure(42, { quoteId: 'signed-quote' }),
    ).resolves.toEqual({ success: true });
    expect(h.pricingExperiment.recordExposure).toHaveBeenCalledWith(
      42,
      'signed-quote',
    );
  });

  it('rejects an exposure request with no quote identifier', async () => {
    const h = makeController();

    await expect(
      h.controller.recordPricingExposure(42, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.pricingExperiment.recordExposure).not.toHaveBeenCalled();
  });
});
