import { describe, expect, it, jest } from '@jest/globals';
import { AcquisitionGrowthService } from './acquisition-growth.service';
import { EventType } from '../user-event/type/event-type.enum';

function makeService() {
  const now = Date.now();
  const users = [
    {
      id: 1,
      createdAt: new Date(now - 40 * 86_400_000),
      isCompleted: true,
      acquisitionSource: 'google',
      acquisitionKeyword: null,
      metadata: {
        acquisition: {
          firstTouch: {
            source: 'google',
            medium: 'organic',
            campaign: 'trust',
            campaignId: 'g-01',
            landingPage: 'https://yarsalam.top/trust?secret=not-store',
            capturedAt: new Date(now - 40 * 86_400_000).toISOString(),
          },
        },
      },
    },
    {
      id: 2,
      createdAt: new Date(now - 12 * 86_400_000),
      isCompleted: false,
      acquisitionSource: 'mobile',
      acquisitionKeyword: null,
      metadata: {},
    },
    {
      id: 3,
      createdAt: new Date(now - 2 * 86_400_000),
      isCompleted: true,
      acquisitionSource: 'instagram',
      acquisitionKeyword: null,
      metadata: {},
    },
  ];
  const events = [
    { userId: 1, type: EventType.LIKE, createdAt: new Date(now - 35 * 86_400_000), metadata: {} },
    { userId: 1, type: EventType.APP_OPEN, createdAt: new Date(now - 33 * 86_400_000), metadata: {} },
    { userId: 1, type: EventType.MESSAGE_SENT, createdAt: new Date(now - 5 * 86_400_000), metadata: {} },
    { userId: 1, type: EventType.PURCHASE, createdAt: new Date(now - 4 * 86_400_000), metadata: { isCommercialPurchase: true, currency: 'IRT', amountRials: 300_000 } },
    { userId: 1, type: EventType.LOGIN, createdAt: new Date(now - 2 * 86_400_000), metadata: { kind: 'acquisition_touch', acquisitionTouch: { source: 'instagram', medium: 'social', campaign: 'return-link', campaignId: 'ig-r1', capturedAt: new Date(now - 2 * 86_400_000).toISOString() } } },
    { userId: 1, type: EventType.WALLET_CHARGED, createdAt: new Date(now - 3 * 86_400_000), metadata: { amountRials: 900_000 } },
    { userId: 2, type: EventType.USER_REGISTERED, createdAt: new Date(now - 12 * 86_400_000), metadata: { lastTouch: { source: 'referral', medium: 'invite', campaign: null, campaignId: null, capturedAt: new Date(now - 12 * 86_400_000).toISOString() } } },
    { userId: 2, type: EventType.LOGIN, createdAt: new Date(now - 5 * 86_400_000), metadata: {} },
    { userId: 2, type: EventType.PURCHASE, createdAt: new Date(now - 4 * 86_400_000), metadata: { isCommercialPurchase: false, currency: 'IRT', amountRials: 500_000 } },
  ];
  const costRows = [
    { source: 'google_organic', medium: 'organic', campaign: 'trust', campaignId: 'g-01', currency: 'IRT', amount: '120000', occurredAt: new Date(now - 30 * 86_400_000) },
    { source: 'instagram', medium: null, campaign: null, campaignId: null, currency: 'IRT', amount: '0', occurredAt: new Date(now - 1 * 86_400_000) },
  ];
  const userRepo: any = { find: jest.fn(async () => users) };
  const eventRepo: any = { find: jest.fn(async () => events) };
  const costRepo: any = {
    find: jest.fn(async () => costRows),
    findOne: jest.fn(async () => null),
    create: jest.fn(value => value),
    save: jest.fn(async value => value),
  };
  return { service: new AcquisitionGrowthService(userRepo, eventRepo, costRepo), userRepo, eventRepo, costRepo };
}

describe('AcquisitionGrowthService', () => {
  it('keeps first touch, separates wallet deposits from product purchases and reports CAC only with explicit costs', async () => {
    const h = makeService();
    const report = await h.service.getReport(90, 'IRT');
    const google = report.rows.find(row => row.source === 'google_organic');
    const unattributed = report.rows.find(row => row.source === 'unattributed');
    const instagram = report.rows.find(row => row.source === 'instagram');

    expect(google).toMatchObject({
      newUsers: 1,
      profileCompletedUsers: 1,
      firstInteractionUsers: 1,
      d7EligibleUsers: 1,
      d7RetainedUsers: 1,
      d30EligibleUsers: 1,
      d30RetainedUsers: 1,
      firstPurchasers: 1,
      grossPurchaseRevenueRials: 300_000,
      costAmount: 120_000,
      cac: 120_000,
      grossRevenuePerAcquiredUser: 300_000,
      ltvOverCac: 2.5,
    });
    expect(unattributed).toMatchObject({ newUsers: 1, cac: null });
    expect(instagram).toMatchObject({ newUsers: 1, costAmount: 0, cac: 0, ltvOverCac: null });
    expect(report.lastTouchTrackedUsers).toBe(2);
    expect(report.lastTouchSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source: 'instagram', medium: 'social', campaignId: 'ig-r1', users: 1}),
        expect.objectContaining({source: 'referral', medium: 'invite', users: 1}),
      ]),
    );
    expect(report.interpretation).toContain('observational_descriptive_only');
    expect(report.interpretation).toContain('wallet top-ups');
  });

  it('records cost entries idempotently and rejects a reused key with different values', async () => {
    const h = makeService();
    const input = {
      source: 'google',
      medium: 'organic',
      campaign: 'trust',
      campaignId: 'g-01',
      category: 'media' as const,
      amount: 123_450,
      currency: 'IRT' as const,
      occurredAt: '2026-11-13T10:00:00.000Z',
      notes: 'invoice-42',
      idempotencyKey: 'cost-key-0001',
    };

    const first = await h.service.createCost(input, 'superadmin-1');
    expect(first).toMatchObject({
      success: true,
      duplicate: false,
      cost: {
        source: 'google_organic',
        medium: 'organic',
        campaignId: 'g-01',
        amount: '123450.00',
        currency: 'IRT',
      },
    });

    h.costRepo.findOne.mockResolvedValueOnce(first.cost);
    const retry = await h.service.createCost(input, 'superadmin-1');
    expect(retry).toMatchObject({success: true, duplicate: true});
    expect(h.costRepo.save).toHaveBeenCalledTimes(1);

    h.costRepo.findOne.mockResolvedValueOnce(first.cost);
    await expect(
      h.service.createCost({...input, amount: 123_451}, 'superadmin-1'),
    ).rejects.toThrow('idempotencyKey was already used for a different cost entry');
  });

  it('keeps explicit zero cost distinct from missing cost and rejects malformed currencies', async () => {
    const h = makeService();
    const input = {
      source: 'instagram',
      category: 'media' as const,
      amount: 0,
      currency: 'IRT' as const,
      occurredAt: '2026-11-13T10:00:00.000Z',
      idempotencyKey: 'cost-key-zero-01',
    };
    await h.service.createCost(input, 'superadmin-1');
    expect(h.costRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({amount: '0.00', source: 'instagram'}),
    );
    await expect(
      h.service.createCost({...input, currency: 'EUR' as any, idempotencyKey: 'cost-key-eur-01'}, 'superadmin-1'),
    ).rejects.toThrow('Unsupported acquisition cost currency');
  });

  it('does not fabricate a CAC when no matching cost entries exist', async () => {
    const h = makeService();
    h.costRepo.find.mockResolvedValueOnce([]);
    const report = await h.service.getReport(90, 'IRT');
    expect(report.rows.find(row => row.source === 'google_organic')?.cac).toBeNull();
  });
});
