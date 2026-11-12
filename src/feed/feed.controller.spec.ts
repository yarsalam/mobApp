import { describe, expect, it, jest } from '@jest/globals';
import { FeedController } from './feed.controller';

describe('FeedController promotion event wiring', () => {
  const makeController = () => {
    const feedAssembler = { buildFeed: jest.fn(async () => []) };
    const response = { success: true as const, duplicate: false };
    const trackImpression = jest.fn(async () => response);
    const trackClick = jest.fn(async () => response);
    const trackDismiss = jest.fn(async () => response);
    const promotionExposure = { trackImpression, trackClick, trackDismiss };

    return {
      controller: new FeedController(feedAssembler as any, promotionExposure as any),
      promotionExposure,
    };
  };

  it('records an impression only through the explicit visibility endpoint', async () => {
    const { controller, promotionExposure } = makeController();
    const result = await controller.impressionPromotion(42, 'promotion-uuid');

    expect(promotionExposure.trackImpression).toHaveBeenCalledWith(42, 'promotion-uuid');
    expect(result).toEqual({ success: true, duplicate: false });
  });

  it('routes promotion clicks to the exposure service', async () => {
    const { controller, promotionExposure } = makeController();
    const result = await controller.clickPromotion(42, 'promotion-uuid');

    expect(promotionExposure.trackClick).toHaveBeenCalledWith(42, 'promotion-uuid');
    expect(result).toEqual({ success: true, duplicate: false });
  });

  it('routes dismissals to the exposure service instead of returning a placeholder', async () => {
    const { controller, promotionExposure } = makeController();
    const result = await controller.dismissPromotion(42, 'promotion-uuid');

    expect(promotionExposure.trackDismiss).toHaveBeenCalledWith(42, 'promotion-uuid');
    expect(result).toEqual({
      success: true,
      duplicate: false,
      message: 'تبلیغ با موفقیت بسته شد',
    });
  });
});
