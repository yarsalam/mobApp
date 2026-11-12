import { BadRequestException } from '@nestjs/common';
import { AcquisitionGrowthService } from './acquisition-growth.service';

describe('AcquisitionGrowthService', () => {
  const now = new Date('2026-11-12T12:00:00.000Z');

  const registrationRows = [
    { source: 'google', registrations: '10', completedProfiles: '8', verifiedUsers: '7', faceVerifiedUsers: '3' },
    { source: 'unknown', registrations: '5', completedProfiles: '3', verifiedUsers: '2', faceVerifiedUsers: '1' },
  ];
  const d7Rows = [
    { source: 'google', eligibleUsers: '8', retainedUsers: '6' },
    { source: 'unknown', eligibleUsers: '5', retainedUsers: '2' },
  ];
  const d30Rows = [
    { source: 'google', eligibleUsers: '7', retainedUsers: '4' },
    { source: 'unknown', eligibleUsers: '4', retainedUsers: '1' },
  ];

  let users: { query: jest.Mock };
  let events: { query: jest.Mock };
  let payments: { query: jest.Mock };
  let service: AcquisitionGrowthService;

  beforeEach(() => {
    users = {
      query: jest.fn((sql: string) => {
        if (sql.includes('INTERVAL 7 DAY')) return Promise.resolve(d7Rows);
        if (sql.includes('INTERVAL 30 DAY')) return Promise.resolve(d30Rows);
        return Promise.resolve(registrationRows);
      }),
    };
    events = {
      query: jest.fn().mockResolvedValue([
        { source: 'google', activatedUsers: '4' },
        { source: 'unknown', activatedUsers: '1' },
      ]),
    };
    payments = {
      query: jest.fn().mockResolvedValue([
        { source: 'google', currency: 'IRT', paidTransactions: '3', payingUsers: '2', amountMinorUnits: '30000' },
        { source: 'unknown', currency: 'USD', paidTransactions: '1', payingUsers: '1', amountMinorUnits: '600' },
      ]),
    };
    service = new AcquisitionGrowthService(users as any, events as any, payments as any);
  });

  it('reports real cohort stages and keeps unattributed users in unknown', async () => {
    const report = await service.getReport(30, now);

    expect(report.totals.registrations).toBe(15);
    expect(report.totals.completedProfiles).toBe(11);
    expect(report.totals.firstWeekActivatedUsers).toBe(5);
    expect(report.channels.map((item) => item.source)).toEqual(['google', 'unknown']);
    expect(report.channels[0].profileCompletionRate).toBe(0.8);
    expect(report.channels[1].firstWeekActivationRate).toBe(0.2);
    expect(report.attribution.missingSource).toBe('unknown');
  });

  it('calculates D7 and D30 retention only from matured cohorts', async () => {
    const report = await service.getReport(30, now);

    expect(report.retentionCohorts.d7).toEqual({
      eligibleUsers: 13,
      retainedUsers: 8,
      rate: 0.6154,
    });
    expect(report.retentionCohorts.d30).toEqual({
      eligibleUsers: 11,
      retainedUsers: 5,
      rate: 0.4545,
    });
    expect(users.query.mock.calls[1][1][0]).toEqual(new Date('2026-10-06T12:00:00.000Z'));
    expect(users.query.mock.calls[1][1][1]).toEqual(new Date('2026-11-05T12:00:00.000Z'));
  });

  it('keeps revenue separated by currency and refuses to fabricate CAC', async () => {
    const report = await service.getReport(30, now);

    expect(report.paidRevenue).toHaveLength(2);
    expect(report.paidRevenue.map((item) => item.currency)).toEqual(['IRT', 'USD']);
    expect(report.paidRevenue[0].amountMinorUnits).toBe(30000);
    expect(report.cac).toEqual({
      value: null,
      status: 'unavailable',
      reason: 'Campaign spend currency and a reliable source-to-spend mapping are not recorded.',
    });
  });

  it('does not accept invalid reporting windows', async () => {
    await expect(service.getReport(0, now)).rejects.toBeInstanceOf(BadRequestException);
    expect(users.query).not.toHaveBeenCalled();
  });
});
