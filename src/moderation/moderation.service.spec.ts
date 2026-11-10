import { describe, expect, it, jest } from '@jest/globals';
import { ModerationService } from './moderation.service';
import { EventType } from 'src/user-event/type/event-type.enum';

function makeQueryBuilder(rows: any[] = []) {
  const builder: any = {
    select: jest.fn(() => builder),
    addSelect: jest.fn(() => builder),
    where: jest.fn(() => builder),
    andWhere: jest.fn(() => builder),
    setParameters: jest.fn(() => builder),
    groupBy: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    addOrderBy: jest.fn(() => builder),
    take: jest.fn(() => builder),
    getRawMany: jest.fn(async () => rows),
    getMany: jest.fn(async () => rows),
  };
  return builder;
}

function makeService(options: any = {}) {
  const userRepo: any = {
    findOne: jest.fn(async () => options.user ?? {
      id: 42,
      status: 'active',
      canSendMessage: false,
      restrictedUntil: new Date('2026-11-11T00:00:00.000Z'),
    }),
    save: jest.fn(async (user: any) => user),
    createQueryBuilder: jest.fn(() => options.userBuilder ?? makeQueryBuilder([])),
  };
  const logRepo: any = {
    count: jest.fn(async () => options.total ?? 0),
    find: jest.fn(async () => options.logs ?? []),
    createQueryBuilder: jest.fn(() => options.logBuilder ?? makeQueryBuilder([])),
    query: jest.fn(async () => [{ ok: 1 }]),
  };
  const userEventService: any = { log: jest.fn(async () => undefined) };
  const service = new ModerationService(
    userRepo,
    {} as any,
    logRepo,
    userEventService,
    {} as any,
    {} as any,
    { add: jest.fn() } as any,
  );
  return { service, userRepo, logRepo, userEventService };
}

describe('ModerationService operational safety contracts', () => {
  it('does not fabricate a zero-risk profile when no moderation evidence exists', async () => {
    const h = makeService({ total: 0, logs: [] });

    const result = await h.service.getUserRiskProfile(42);

    expect(result.status).toBe('insufficient_data');
    expect(result.risk).toBeNull();
    expect(result.level).toBe('unknown');
    expect(result.evidenceCount).toBe(0);
  });

  it('computes a transparent rule-based risk summary from recorded severities', async () => {
    const h = makeService({
      total: 3,
      logs: [
        { severity: 'medium', flags: ['external_contact'], createdAt: new Date('2026-11-09T10:00:00Z') },
        { severity: 'high', flags: ['scam'], createdAt: new Date('2026-11-09T11:00:00Z') },
        { severity: 'critical', flags: ['threat'], createdAt: new Date('2026-11-09T12:00:00Z') },
      ],
    });

    const result = await h.service.getUserRiskProfile(42);

    expect(result.risk).toBe(65);
    expect(result.level).toBe('critical');
    expect(result.method).toBe('rule_based_moderation_log_counts_v1');
    expect(result.topFlags[0]).toEqual({ flag: 'external_contact', count: 1 });
    expect(result.note).toContain('not a calibrated ML risk probability');
  });

  it('returns actual aggregated daily moderation rows and bounded date window', async () => {
    const builder = makeQueryBuilder([
      { date: '2026-11-09', total: '4', low: '1', medium: '1', high: '1', critical: '1' },
    ]);
    const h = makeService({ logBuilder: builder });

    const result = await h.service.getDailyStats(7);

    expect(builder.getRawMany).toHaveBeenCalledTimes(1);
    expect(result.periodDays).toBe(7);
    expect(result.totals).toEqual({ total: 4, low: 1, medium: 1, high: 1, critical: 1 });
    expect(result.byDay[0].date).toBe('2026-11-09');
  });

  it('enriches high-risk users only from matching log evidence and selected safe fields', async () => {
    const logBuilder = makeQueryBuilder([
      { userId: '42', violationCount: '3', riskPoints: '65', lastViolationAt: new Date('2026-11-09T12:00:00Z') },
    ]);
    const userBuilder = makeQueryBuilder([
      { id: 42, nickname: 'sample', status: 'active', canSendMessage: false, restrictedUntil: null },
    ]);
    const h = makeService({ logBuilder, userBuilder });

    const result = await h.service.getHighRiskUsers(20, 'high');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ userId: 42, risk: 65, level: 'critical', violationCount: 3 });
    expect(userBuilder.select).toHaveBeenCalledWith([
      'user.id',
      'user.nickname',
      'user.status',
      'user.canSendMessage',
      'user.restrictedUntil',
    ]);
  });

  it('does not lift a separate account-level suspension through the moderation unblock endpoint', async () => {
    const user = { id: 42, status: 'admin_blocked', canSendMessage: false };
    const h = makeService({ user });

    const result = await h.service.unblockUser(42);

    expect(result.unblocked).toBe(false);
    expect(result.reason).toBe('account_status_requires_separate_admin_review');
    expect(h.userRepo.save).not.toHaveBeenCalled();
    expect(h.userEventService.log).not.toHaveBeenCalled();
  });

  it('clears only a moderation messaging restriction and records an audit event', async () => {
    const user = {
      id: 42,
      status: 'active',
      canSendMessage: false,
      restrictedUntil: new Date('2026-11-11T00:00:00Z'),
    };
    const h = makeService({ user });

    const result = await h.service.unblockUser(42);

    expect(result.unblocked).toBe(true);
    expect(user.canSendMessage).toBe(true);
    expect(user.restrictedUntil).toBeUndefined();
    expect(h.userRepo.save).toHaveBeenCalledWith(user);
    expect(h.userEventService.log).toHaveBeenCalledWith({
      userId: 42,
      type: EventType.USER_UNBLOCKED,
      metadata: {
        source: 'moderation_admin_action',
        previousCanSendMessage: false,
      },
    });
  });

  it('reports database health without claiming that the remote AI service was probed', async () => {
    const h = makeService();

    const result = await h.service.healthCheck();

    expect(h.logRepo.query).toHaveBeenCalledWith('SELECT 1');
    expect(result.database).toBe('ok');
    expect(result.aiModerationProbe).toBe('not_performed');
  });
});
