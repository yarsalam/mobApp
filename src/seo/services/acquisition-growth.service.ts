import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PartitionedEvent } from '../../user-event/entities/partitioned-event.entity';
import { Payment } from '../../payments/entities/payment.entity';

type AggregateRow = Record<string, string | number | null | undefined>;

const SOURCE_SQL =
  "COALESCE(NULLIF(TRIM(u.acquisitionSource), ''), " +
  "NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(u.metadata, '$.acquisitionSource'))), ''), " +
  "'unknown')";

@Injectable()
export class AcquisitionGrowthService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(PartitionedEvent)
    private readonly events: Repository<PartitionedEvent>,
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
  ) {}

  async getReport(days = 30, now = new Date()) {
    if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
      throw new BadRequestException('days must be an integer between 1 and 365');
    }

    const periodStart = new Date(now.getTime() - days * 86_400_000);
    const d7CohortStart = new Date(now.getTime() - (days + 7) * 86_400_000);
    const d7CohortEnd = new Date(now.getTime() - 7 * 86_400_000);
    const d30CohortStart = new Date(now.getTime() - (days + 30) * 86_400_000);
    const d30CohortEnd = new Date(now.getTime() - 30 * 86_400_000);

    const registrationsSql =
      'SELECT ' + SOURCE_SQL + ' AS source, COUNT(*) AS registrations, ' +
      'SUM(CASE WHEN u.isCompleted = 1 THEN 1 ELSE 0 END) AS completedProfiles, ' +
      'SUM(CASE WHEN u.isVerified = 1 THEN 1 ELSE 0 END) AS verifiedUsers, ' +
      'SUM(CASE WHEN u.isFaceVerified = 1 THEN 1 ELSE 0 END) AS faceVerifiedUsers ' +
      'FROM `user` u WHERE u.createdAt >= ? AND u.createdAt <= ? GROUP BY source';

    const activationSql =
      'SELECT ' + SOURCE_SQL + ' AS source, COUNT(DISTINCT u.id) AS activatedUsers ' +
      'FROM `user` u INNER JOIN user_events e ON e.userId = u.id ' +
      'WHERE u.createdAt >= ? AND u.createdAt <= ? ' +
      'AND e.createdAt >= u.createdAt AND e.createdAt < DATE_ADD(u.createdAt, INTERVAL 7 DAY) ' +
      "AND e.type IN ('like', 'match', 'message_sent') GROUP BY source";

    const retentionSql = (day: 7 | 30) =>
      'SELECT ' + SOURCE_SQL + ' AS source, COUNT(*) AS eligibleUsers, ' +
      'SUM(CASE WHEN EXISTS (SELECT 1 FROM user_events e WHERE e.userId = u.id ' +
      "AND e.type IN ('app_open', 'login', 'profile_view', 'like', 'match', 'message_sent') " +
      'AND e.createdAt >= DATE_ADD(u.createdAt, INTERVAL ' + day + ' DAY) ' +
      'AND e.createdAt < DATE_ADD(u.createdAt, INTERVAL ' + (day + 1) + ' DAY)) ' +
      'THEN 1 ELSE 0 END) AS retainedUsers ' +
      'FROM `user` u WHERE u.createdAt >= ? AND u.createdAt < ? GROUP BY source';

    const revenueSql =
      'SELECT ' + SOURCE_SQL + ' AS source, p.currency AS currency, ' +
      'COUNT(*) AS paidTransactions, COUNT(DISTINCT u.id) AS payingUsers, ' +
      'SUM(p.amount) AS amountMinorUnits ' +
      'FROM payments p INNER JOIN `user` u ON u.id = p.userId ' +
      "WHERE p.status = 'paid' AND COALESCE(p.confirmedAt, p.createdAt) >= ? " +
      'AND COALESCE(p.confirmedAt, p.createdAt) <= ? ' +
      'GROUP BY source, p.currency ORDER BY source, p.currency';

    const [registrationRows, activationRows, d7Rows, d30Rows, revenueRows] =
      await Promise.all([
        this.users.query(registrationsSql, [periodStart, now]) as Promise<AggregateRow[]>,
        this.events.query(activationSql, [periodStart, now]) as Promise<AggregateRow[]>,
        this.users.query(retentionSql(7), [d7CohortStart, d7CohortEnd]) as Promise<AggregateRow[]>,
        this.users.query(retentionSql(30), [d30CohortStart, d30CohortEnd]) as Promise<AggregateRow[]>,
        this.payments.query(revenueSql, [periodStart, now]) as Promise<AggregateRow[]>,
      ]);

    const activationBySource = new Map(
      activationRows.map((row) => [String(row.source || 'unknown'), this.count(row.activatedUsers)]),
    );
    const d7BySource = new Map(d7Rows.map((row) => [String(row.source || 'unknown'), row]));
    const d30BySource = new Map(d30Rows.map((row) => [String(row.source || 'unknown'), row]));

    const channels = registrationRows
      .map((row) => {
        const source = String(row.source || 'unknown');
        const registrations = this.count(row.registrations);
        const activatedUsers = activationBySource.get(source) ?? 0;
        return {
          source,
          registrations,
          completedProfiles: this.count(row.completedProfiles),
          verifiedUsers: this.count(row.verifiedUsers),
          faceVerifiedUsers: this.count(row.faceVerifiedUsers),
          firstWeekActivatedUsers: activatedUsers,
          profileCompletionRate: this.rate(this.count(row.completedProfiles), registrations),
          verificationRate: this.rate(this.count(row.verifiedUsers), registrations),
          faceVerificationRate: this.rate(this.count(row.faceVerifiedUsers), registrations),
          firstWeekActivationRate: this.rate(activatedUsers, registrations),
          retentionD7: this.retention(d7BySource.get(source)),
          retentionD30: this.retention(d30BySource.get(source)),
        };
      })
      .sort((a, b) => b.registrations - a.registrations);

    const totalRegistrations = channels.reduce((sum, row) => sum + row.registrations, 0);
    const totalActivated = channels.reduce((sum, row) => sum + row.firstWeekActivatedUsers, 0);
    const totalCompleted = channels.reduce((sum, row) => sum + row.completedProfiles, 0);
    const totalVerified = channels.reduce((sum, row) => sum + row.verifiedUsers, 0);

    return {
      status: 'available',
      window: {
        days,
        from: periodStart.toISOString(),
        to: now.toISOString(),
      },
      attribution: {
        sourceBasis: 'user.acquisitionSource, then metadata.acquisitionSource',
        missingSource: 'unknown',
        dimensionsNotCollected: ['medium', 'campaign', 'landingPage', 'referrer', 'firstTouch', 'lastTouch'],
      },
      totals: {
        registrations: totalRegistrations,
        completedProfiles: totalCompleted,
        verifiedUsers: totalVerified,
        firstWeekActivatedUsers: totalActivated,
        profileCompletionRate: this.rate(totalCompleted, totalRegistrations),
        verificationRate: this.rate(totalVerified, totalRegistrations),
        firstWeekActivationRate: this.rate(totalActivated, totalRegistrations),
      },
      channels,
      retentionCohorts: {
        d7: this.aggregateRetention(d7Rows),
        d30: this.aggregateRetention(d30Rows),
      },
      paidRevenue: revenueRows.map((row) => ({
        source: String(row.source || 'unknown'),
        currency: String(row.currency || 'unknown'),
        paidTransactions: this.count(row.paidTransactions),
        payingUsers: this.count(row.payingUsers),
        amountMinorUnits: String(row.amountMinorUnits ?? '0'),
      })),
      cac: {
        value: null,
        status: 'unavailable',
        reason: 'Campaign spend currency and a reliable source-to-spend mapping are not recorded.',
      },
    };
  }

  private count(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private rate(numerator: number, denominator: number): number | null {
    return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
  }

  private retention(row?: AggregateRow) {
    const eligible = this.count(row?.eligibleUsers);
    const retained = this.count(row?.retainedUsers);
    return {
      eligibleUsers: eligible,
      retainedUsers: retained,
      rate: this.rate(retained, eligible),
    };
  }

  private aggregateRetention(rows: AggregateRow[]) {
    const eligible = rows.reduce((sum, row) => sum + this.count(row.eligibleUsers), 0);
    const retained = rows.reduce((sum, row) => sum + this.count(row.retainedUsers), 0);
    return {
      eligibleUsers: eligible,
      retainedUsers: retained,
      rate: this.rate(retained, eligible),
    };
  }
}
