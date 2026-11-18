import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ManualPromotionService } from './manual-promotion.service';

function activeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Test campaign',
    title: 'پیشنهاد ویژه',
    subtitle: 'تخفیف محدود',
    ctaText: 'خرید',
    bundleCode: 'vip-month',
    discountType: 'percent',
    discountValue: 20,
    audienceType: 'all',
    audienceUserIds: null,
    audiencePhases: null,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 60 * 60_000),
    maxRedemptions: 10,
    perUserLimit: 1,
    priority: 0,
    active: true,
    ...overrides,
  };
}

function makeService(options: {
  campaign?: any;
  phase?: string;
  user?: any;
  globalCount?: number;
  userCount?: number;
} = {}) {
  const campaign = options.campaign ?? activeCampaign();
  const campaigns: any = {
    findOne: jest.fn(async () => campaign),
    find: jest.fn(async () => [campaign]),
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => value),
    update: jest.fn(async () => ({ affected: 1 })),
  };
  const redemptions: any = {
    count: jest.fn(async (args: any) =>
      args?.where?.userId ? (options.userCount ?? 0) : (options.globalCount ?? 0),
    ),
    findOne: jest.fn(async () => null),
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => value),
    update: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(() => ({
      select: () => ({
        where: () => ({
          andWhere: () => ({
            getRawOne: async () => ({ discountRials: '0' }),
          }),
        }),
      }),
    })),
  };
  const bundles: any = {
    findOne: jest.fn(async () => ({
      code: 'vip-month',
      price: 100_000,
      active: true,
    })),
  };
  const users: any = {
    findOne: jest.fn(async () => options.user ?? ({ id: 42, status: 'active' })),
  };
  const phases: any = {
    get: jest.fn(async () => ({ phase: options.phase ?? 'warm' })),
  };
  const dataSource: any = {
    transaction: async (callback: (manager: any) => unknown) =>
      callback({
        getRepository: (entity: any) => {
          if (entity.name === 'ManualPromotionCampaign') return campaigns;
          if (entity.name === 'ManualPromotionRedemption') return redemptions;
          if (entity.name === 'ProductBundle') return bundles;
          throw new Error('Unexpected repository');
        },
      }),
  };
  const service = new ManualPromotionService(
    campaigns,
    redemptions,
    bundles,
    users,
    phases,
    dataSource,
  );
  return { service, campaigns, redemptions, bundles, users, phases, dataSource };
}

describe('ManualPromotionService', () => {
  it('calculates the treatment price on the server from the active bundle price', async () => {
    const h = makeService();
    const quote = await h.service.getQuote(42, activeCampaign().id, 'vip-month');

    expect(quote).toMatchObject({
      campaignId: activeCampaign().id,
      basePriceRials: 100_000,
      discountRials: 20_000,
      payablePriceRials: 80_000,
      discountType: 'percent',
      discountValue: 20,
      currency: 'IRT',
    });
    expect(h.users.findOne).toHaveBeenCalledWith({
      where: { id: 42 },
      select: ['id', 'status'],
    });
  });

  it('does not expose a campaign to a user outside its manually selected audience', async () => {
    const h = makeService({
      campaign: activeCampaign({
        audienceType: 'users',
        audienceUserIds: [7, 8],
      }),
    });
    await expect(
      h.service.getQuote(42, activeCampaign().id, 'vip-month'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('targets phase groups using the current server-side phase', async () => {
    const h = makeService({
      campaign: activeCampaign({
        audienceType: 'phases',
        audienceUserIds: null,
        audiencePhases: ['hot'],
      }),
      phase: 'warm',
    });
    await expect(
      h.service.getQuote(42, activeCampaign().id, 'vip-month'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fails closed for inactive accounts and for exhausted campaign limits', async () => {
    const inactive = makeService({ user: { id: 42, status: 'disabled' } });
    await expect(
      inactive.service.getQuote(42, activeCampaign().id, 'vip-month'),
    ).rejects.toBeInstanceOf(NotFoundException);

    const exhausted = makeService({
      globalCount: 10,
      campaign: activeCampaign({ maxRedemptions: 10 }),
    });
    await expect(
      exhausted.service.getQuote(42, activeCampaign().id, 'vip-month'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects fixed discounts that would make a bundle free or negative', async () => {
    const h = makeService({
      campaign: activeCampaign({ discountType: 'fixed', discountValue: 100_000 }),
    });
    await expect(
      h.service.getQuote(42, activeCampaign().id, 'vip-month'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates manual campaigns disabled unless the administrator explicitly enables them', async () => {
    const h = makeService();
    const saved = await h.service.createCampaign({
      name: 'New offer',
      title: 'Offer',
      subtitle: 'One offer',
      bundleCode: 'vip-month',
      discountType: 'percent',
      discountValue: 15,
      audienceType: 'all',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      active: false,
    });
    expect(saved.active).toBe(false);
    expect(saved.discountValue).toBe(15);
  });
});
