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
    { userId: 1, type: EventType.WALLET_CHARGED, createdAt: new Date(now - 3 * 86_400_000), metadata: { amountRials: 900_000 } },
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
    expect(report.interpretation).toContain('observational_descriptive_only');
    expect(report.interpretation).toContain('wallet top-ups');
  });

  it('does not fabricate a CAC when no matching cost entries exist', async () => {
    const h = makeService();
    h.costRepo.find.mockResolvedValueOnce([]);
    const report = await h.service.getReport(90, 'IRT');
    expect(report.rows.find(row => row.source === 'google_organic')?.cac).toBeNull();
  });
});
