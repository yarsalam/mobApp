import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentCurrency } from '../payments/entities/payment.entity';
import { User } from '../users/entities/user.entity';
import { UserVip } from '../payments/vip/entities/vip.entity';
import { PartitionedEvent } from '../user-event/entities/partitioned-event.entity';
import { EventType } from '../user-event/type/event-type.enum';

function finite(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function classifyGender(value: unknown): 'male' | 'female' | 'unknown' {
  const gender = String(value ?? '').trim().toLocaleLowerCase();
  if (['male', 'man', 'm', 'مرد', 'آقا', 'اقا'].includes(gender)) return 'male';
  if (['female', 'woman', 'f', 'زن', 'خانم'].includes(gender)) return 'female';
  return 'unknown';
}

function sinceDays(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function currencyUnit(currency: PaymentCurrency): string {
  switch (currency) {
    case 'IRT': return 'rial';
    case 'USDT': return 'cent';
    case 'BTC': return 'satoshi';
    case 'USD': return 'raw_unit_unverified';
  }
}

@Injectable()
export class RevenueAnalyticsService {
  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserVip) private readonly vips: Repository<UserVip>,
    @InjectRepository(PartitionedEvent) private readonly events: Repository<PartitionedEvent>,
  ) {}

  async byGender(currency: PaymentCurrency = 'IRT', days = 90) {
    const since = sinceDays(days);
    const reasonExpr = "JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.reason'))";
    const amountExpr = "CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.amountRials')), '0') AS DECIMAL(20,0))";
    const purchaseAmountExpr = "CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.amountRials')), '0') AS DECIMAL(20,0))";

    const [debitRows, fulfilledRows, depositRows] = await Promise.all([
      this.events.createQueryBuilder('e')
        .innerJoin('e.user', 'u')
        .select('u.gender', 'gender')
        .addSelect(`SUM(${amountExpr})`, 'debitRevenue')
        .addSelect('COUNT(*)', 'debitCount')
        .addSelect('COUNT(DISTINCT e.userId)', 'debitUsers')
        .where('e.type = :type', { type: EventType.CREDITS_SPENT })
        .andWhere(`${reasonExpr} LIKE :reason`, { reason: 'buy:%' })
        .andWhere('e.createdAt >= :since', { since })
        .groupBy('u.gender')
        .getRawMany(),
      this.events.createQueryBuilder('e')
        .innerJoin('e.user', 'u')
        .select(
          "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.genderAtPurchase')), ''), u.gender)",
          'gender',
        )
        .addSelect(`SUM(${purchaseAmountExpr})`, 'fulfilledRevenue')
        .addSelect('COUNT(*)', 'fulfilledCount')
        .addSelect('COUNT(DISTINCT e.userId)', 'fulfilledUsers')
        .addSelect(
          "SUM(CASE WHEN JSON_EXTRACT(e.metadata, '$.genderAtPurchase') IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.genderAtPurchase')) = '' THEN 1 ELSE 0 END)",
          'legacyGenderFallbackCount',
        )
        .where('e.type = :type', { type: EventType.PURCHASE })
        .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.isCommercialPurchase')) = 'true'")
        .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.currency')) = 'IRT'")
        .andWhere('e.createdAt >= :since', { since })
        .groupBy("COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.genderAtPurchase')), ''), u.gender)")
        .getRawMany(),
      this.payments.createQueryBuilder('p')
        .innerJoin('p.user', 'u')
        .select('u.gender', 'gender')
        .addSelect('SUM(p.amount)', 'depositRevenue')
        .addSelect('COUNT(*)', 'depositCount')
        .addSelect('COUNT(DISTINCT p.userId)', 'depositingUsers')
        .where('p.status = :status', { status: 'paid' })
        .andWhere('p.productCode = :productCode', { productCode: 'wallet_charge' })
        .andWhere('p.currency = :currency', { currency })
        .andWhere('COALESCE(p.confirmedAt, p.createdAt) >= :since', { since })
        .groupBy('u.gender')
        .getRawMany(),
    ]);

    const result = {
      male: { revenue: 0, payingUsers: 0, paymentCount: 0, arppu: 0, fulfilledRevenue: 0, fulfilledPurchaseCount: 0, fulfilledPayingUsers: 0, depositRevenue: 0, depositingUsers: 0, depositCount: 0 },
      female: { revenue: 0, payingUsers: 0, paymentCount: 0, arppu: 0, fulfilledRevenue: 0, fulfilledPurchaseCount: 0, fulfilledPayingUsers: 0, depositRevenue: 0, depositingUsers: 0, depositCount: 0 },
      unknown: { revenue: 0, payingUsers: 0, paymentCount: 0, arppu: 0, fulfilledRevenue: 0, fulfilledPurchaseCount: 0, fulfilledPayingUsers: 0, depositRevenue: 0, depositingUsers: 0, depositCount: 0 },
    };

    for (const row of debitRows) {
      const key = classifyGender(row.gender);
      result[key].revenue += finite(row.debitRevenue);
      result[key].payingUsers += finite(row.debitUsers);
      result[key].paymentCount += finite(row.debitCount);
    }
    let legacyGenderFallbackCount = 0;
    for (const row of fulfilledRows) {
      const key = classifyGender(row.gender);
      result[key].fulfilledRevenue += finite(row.fulfilledRevenue);
      result[key].fulfilledPurchaseCount += finite(row.fulfilledCount);
      result[key].fulfilledPayingUsers += finite(row.fulfilledUsers);
      legacyGenderFallbackCount += finite(row.legacyGenderFallbackCount);
    }
    for (const row of depositRows) {
      const key = classifyGender(row.gender);
      result[key].depositRevenue += finite(row.depositRevenue);
      result[key].depositingUsers += finite(row.depositingUsers);
      result[key].depositCount += finite(row.depositCount);
    }

    for (const row of Object.values(result)) {
      row.revenue = Math.round(row.revenue);
      row.fulfilledRevenue = Math.round(row.fulfilledRevenue);
      row.depositRevenue = Math.round(row.depositRevenue);
      row.arppu = row.payingUsers > 0 ? Math.round(row.revenue / row.payingUsers) : 0;
    }

    return {
      currency: 'IRT',
      unit: 'rial',
      depositCurrency: currency,
      depositUnit: currencyUnit(currency),
      periodDays: days,
      purchaseSource: 'wallet debit events with reason buy:<bundleCode>; checkout spend, not a fulfilment guarantee',
      fulfilledPurchaseSource: 'purchase events with isCommercialPurchase=true and stored IRT amount; event is written after bundle grants succeed',
      depositSource: 'payments.status=paid AND productCode=wallet_charge; confirmedAt with createdAt fallback',
      genderBasis: 'purchase_event_snapshot_with_legacy_current_profile_fallback',
      fulfilledPurchaseGenderBasis: 'genderAtPurchase snapshot on purchase event; legacy events without the field fall back to current profile gender',
      fulfilledPurchaseLegacyGenderFallbackCount: legacyGenderFallbackCount,
      fulfilledPurchaseSnapshotCoveragePercent: (result.male.fulfilledPurchaseCount + result.female.fulfilledPurchaseCount + result.unknown.fulfilledPurchaseCount) > 0
        ? Math.round(((result.male.fulfilledPurchaseCount + result.female.fulfilledPurchaseCount + result.unknown.fulfilledPurchaseCount - legacyGenderFallbackCount) / (result.male.fulfilledPurchaseCount + result.female.fulfilledPurchaseCount + result.unknown.fulfilledPurchaseCount)) * 10000) / 100
        : null,
      walletDebitGenderBasis: 'current user profile gender at query time; debit events do not yet carry a purchase-time snapshot',
      walletDepositGenderBasis: 'current user profile gender at query time; deposit payments do not yet carry a deposit-time snapshot',
      ...result,
      total: {
        revenue: result.male.revenue + result.female.revenue + result.unknown.revenue,
        payingUsers: result.male.payingUsers + result.female.payingUsers + result.unknown.payingUsers,
        paymentCount: result.male.paymentCount + result.female.paymentCount + result.unknown.paymentCount,
        fulfilledRevenue: result.male.fulfilledRevenue + result.female.fulfilledRevenue + result.unknown.fulfilledRevenue,
        fulfilledPurchaseCount: result.male.fulfilledPurchaseCount + result.female.fulfilledPurchaseCount + result.unknown.fulfilledPurchaseCount,
        fulfilledPayingUsers: result.male.fulfilledPayingUsers + result.female.fulfilledPayingUsers + result.unknown.fulfilledPayingUsers,
        depositRevenue: result.male.depositRevenue + result.female.depositRevenue + result.unknown.depositRevenue,
        depositingUsers: result.male.depositingUsers + result.female.depositingUsers + result.unknown.depositingUsers,
        depositCount: result.male.depositCount + result.female.depositCount + result.unknown.depositCount,
      },
    };
  }

  async byProduct(_depositCurrency: PaymentCurrency = 'IRT', days = 90) {
    const reasonExpr = "JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.reason'))";
    const amountExpr = "CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.amountRials')), '0') AS DECIMAL(20,0))";
    const fulfilledAmountExpr = "CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.amountRials')), '0') AS DECIMAL(20,0))";
    const productExpr = `SUBSTRING(${reasonExpr}, 5)`;
    const since = sinceDays(days);

    const [debitRows, fulfilledRows] = await Promise.all([
      this.events.createQueryBuilder('e')
        .select(productExpr, 'product')
        .addSelect(`SUM(${amountExpr})`, 'revenue')
        .addSelect('COUNT(*)', 'transactionCount')
        .addSelect('COUNT(DISTINCT e.userId)', 'payingUsers')
        .where('e.type = :type', { type: EventType.CREDITS_SPENT })
        .andWhere(`${reasonExpr} LIKE :reason`, { reason: 'buy:%' })
        .andWhere('e.createdAt >= :since', { since })
        .groupBy(productExpr)
        .orderBy(`SUM(${amountExpr})`, 'DESC')
        .getRawMany(),
      this.events.createQueryBuilder('e')
        .select("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.bundleCode'))", 'product')
        .addSelect(`SUM(${fulfilledAmountExpr})`, 'fulfilledRevenue')
        .addSelect('COUNT(*)', 'fulfilledPurchaseCount')
        .addSelect('COUNT(DISTINCT e.userId)', 'fulfilledPayingUsers')
        .where('e.type = :type', { type: EventType.PURCHASE })
        .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.isCommercialPurchase')) = 'true'")
        .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.currency')) = 'IRT'")
        .andWhere('e.createdAt >= :since', { since })
        .groupBy("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.bundleCode'))")
        .getRawMany(),
    ]);

    const fulfilledByProduct = new Map<string, {
      revenue: number;
      count: number;
      users: number;
    }>();
    for (const row of fulfilledRows) {
      const product = String(row.product ?? 'unclassified');
      fulfilledByProduct.set(product, {
        revenue: finite(row.fulfilledRevenue),
        count: finite(row.fulfilledPurchaseCount),
        users: finite(row.fulfilledPayingUsers),
      });
    }

    const debitByProduct = new Map<string, {
      revenue: number;
      count: number;
      users: number;
    }>();
    for (const row of debitRows) {
      debitByProduct.set(String(row.product ?? 'unclassified'), {
        revenue: finite(row.revenue),
        count: finite(row.transactionCount),
        users: finite(row.payingUsers),
      });
    }

    // Union both sources: direct card/crypto purchases have a fulfilled event
    // but no wallet-debit event, so they must still appear in the product report.
    const productKeys = new Set<string>([
      ...debitByProduct.keys(),
      ...fulfilledByProduct.keys(),
    ]);
    const products = Array.from(productKeys).map(product => {
      const debit = debitByProduct.get(product);
      const fulfilled = fulfilledByProduct.get(product);
      return {
        product,
        revenue: Math.round(debit?.revenue ?? 0),
        fulfilledRevenue: Math.round(fulfilled?.revenue ?? 0),
        fulfilledPurchaseCount: fulfilled?.count ?? 0,
        fulfilledPayingUsers: fulfilled?.users ?? 0,
        share: 0,
        transactionCount: debit?.count ?? 0,
        payingUsers: debit?.users ?? 0,
      };
    }).sort((a, b) => (b.fulfilledRevenue + b.revenue) - (a.fulfilledRevenue + a.revenue));

    const totalDebit = products.reduce((sum, row) => sum + row.revenue, 0);
    const totalFulfilled = products.reduce((sum, row) => sum + row.fulfilledRevenue, 0);
    const fulfilledPurchaseCount = products.reduce((sum, row) => sum + row.fulfilledPurchaseCount, 0);

    for (const row of products) {
      row.share = totalDebit > 0 ? Math.round((row.revenue / totalDebit) * 10000) / 100 : 0;
    }

    return {
      currency: 'IRT',
      unit: 'rial',
      periodDays: days,
      source: 'union of wallet debit events and successfully fulfilled commercial purchases',
      fulfilledPurchaseSource: 'purchase events with commercial flag and amount after bundle grant success',
      totalRevenue: Math.round(totalDebit),
      totalFulfilledRevenue: Math.round(totalFulfilled),
      fulfilledPurchaseCount,
      rows: products,
    };
  }

  async arppu(depositCurrency: PaymentCurrency = 'IRT', days = 30) {
    const since = sinceDays(days);
    const reasonExpr = "JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.reason'))";
    const amountExpr = "CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.amountRials')), '0') AS DECIMAL(20,0))";
    const [debitRow, fulfilledRow, depositRow, activeUsers] = await Promise.all([
      this.events.createQueryBuilder('e')
        .select(`COALESCE(SUM(${amountExpr}), 0)`, 'revenue')
        .addSelect('COUNT(*)', 'debitCount')
        .addSelect('COUNT(DISTINCT e.userId)', 'payingUsers')
        .where('e.type = :type', { type: EventType.CREDITS_SPENT })
        .andWhere(`${reasonExpr} LIKE :reason`, { reason: 'buy:%' })
        .andWhere('e.createdAt >= :since', { since })
        .getRawOne(),
      this.events.createQueryBuilder('e')
        .select(`COALESCE(SUM(${amountExpr}), 0)`, 'fulfilledRevenue')
        .addSelect('COUNT(*)', 'fulfilledCount')
        .addSelect('COUNT(DISTINCT e.userId)', 'fulfilledUsers')
        .where('e.type = :type', { type: EventType.PURCHASE })
        .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.isCommercialPurchase')) = 'true'")
        .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.currency')) = 'IRT'")
        .andWhere('e.createdAt >= :since', { since })
        .getRawOne(),
      this.payments.createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'depositRevenue')
        .addSelect('COUNT(*)', 'depositCount')
        .addSelect('COUNT(DISTINCT p.userId)', 'depositingUsers')
        .where('p.status = :status', { status: 'paid' })
        .andWhere('p.productCode = :productCode', { productCode: 'wallet_charge' })
        .andWhere('p.currency = :currency', { currency: depositCurrency })
        .andWhere('COALESCE(p.confirmedAt, p.createdAt) >= :since', { since })
        .getRawOne(),
      this.users.createQueryBuilder('u')
        .where('u.status = :status', { status: 'active' })
        .andWhere('u.lastActive >= :since', { since })
        .getCount(),
    ]);

    const totalRevenue = Math.round(finite(debitRow?.revenue));
    const payingUsers = finite(debitRow?.payingUsers);
    return {
      currency: 'IRT',
      unit: 'rial',
      depositCurrency,
      depositUnit: currencyUnit(depositCurrency),
      periodDays: days,
      totalRevenue,
      paymentCount: finite(debitRow?.debitCount),
      payingUsers,
      arppu: payingUsers > 0 ? Math.round(totalRevenue / payingUsers) : 0,
      fulfilledRevenue: Math.round(finite(fulfilledRow?.fulfilledRevenue)),
      fulfilledPurchaseCount: finite(fulfilledRow?.fulfilledCount),
      fulfilledPayingUsers: finite(fulfilledRow?.fulfilledUsers),
      fulfilledArppu: finite(fulfilledRow?.fulfilledUsers) > 0
        ? Math.round(finite(fulfilledRow?.fulfilledRevenue) / finite(fulfilledRow?.fulfilledUsers))
        : null,
      activeUsers,
      payingRate: activeUsers > 0 ? Math.round((payingUsers / activeUsers) * 10000) / 100 : 0,
      depositRevenue: Math.round(finite(depositRow?.depositRevenue)),
      depositCount: finite(depositRow?.depositCount),
      depositingUsers: finite(depositRow?.depositingUsers),
      definition: 'ARPPU = wallet-funded checkout debits (IRT) / distinct buyers; fulfilled purchase event is recorded after bundle grants succeed; deposits are separate.',
    };
  }

  async cohort(_depositCurrency: PaymentCurrency = 'IRT', months = 12) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const amountExpr = "CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.amountRials')), '0') AS DECIMAL(20,0))";
    const rows = await this.users.createQueryBuilder('u')
      .leftJoin(
        'u.userEvents',
        'e',
        `e.type = :eventType AND JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.isCommercialPurchase')) = 'true' AND JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.currency')) = 'IRT' AND e.createdAt >= u.createdAt`,
        { eventType: EventType.PURCHASE },
      )
      .select("DATE_FORMAT(u.createdAt, '%Y-%m')", 'cohort')
      .addSelect('COUNT(DISTINCT u.id)', 'users')
      .addSelect(`SUM(CASE WHEN e.createdAt < DATE_ADD(u.createdAt, INTERVAL 30 DAY) THEN ${amountExpr} ELSE 0 END)`, 'revenue30d')
      .addSelect(`SUM(CASE WHEN e.createdAt < DATE_ADD(u.createdAt, INTERVAL 60 DAY) THEN ${amountExpr} ELSE 0 END)`, 'revenue60d')
      .addSelect(`SUM(CASE WHEN e.createdAt < DATE_ADD(u.createdAt, INTERVAL 90 DAY) THEN ${amountExpr} ELSE 0 END)`, 'revenue90d')
      .addSelect(`SUM(CASE WHEN e.createdAt < DATE_ADD(u.createdAt, INTERVAL 180 DAY) THEN ${amountExpr} ELSE 0 END)`, 'revenue180d')
      .where('u.createdAt >= :since', { since })
      .groupBy("DATE_FORMAT(u.createdAt, '%Y-%m')")
      .orderBy('cohort', 'ASC')
      .getRawMany();

    const now = Date.now();
    return {
      currency: 'IRT',
      unit: 'rial',
      source: 'successfully fulfilled commercial purchase events in IRT; cohort revenue is cumulative from signup and includes wallet, card and crypto bundle purchases',
      cohorts: rows.map(row => {
        const cohortDate = new Date(`${row.cohort}-01T00:00:00`);
        const cohortEnd = new Date(cohortDate);
        cohortEnd.setMonth(cohortEnd.getMonth() + 1);
        cohortEnd.setDate(0);
        const ageDays = Math.floor((now - cohortEnd.getTime()) / 86_400_000);
        return {
          cohort: String(row.cohort),
          users: finite(row.users),
          revenue30d: ageDays >= 30 ? Math.round(finite(row.revenue30d)) : null,
          revenue60d: ageDays >= 60 ? Math.round(finite(row.revenue60d)) : null,
          revenue90d: ageDays >= 90 ? Math.round(finite(row.revenue90d)) : null,
          revenue180d: ageDays >= 180 ? Math.round(finite(row.revenue180d)) : null,
          matureDays: [30, 60, 90, 180].filter(day => ageDays >= day),
          ageDays,
        };
      }),
    };
  }

  async funnel(_depositCurrency: PaymentCurrency = 'IRT', days = 30) {
    const since = sinceDays(days);
    const reasonExpr = "JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.reason'))";
    const amountExpr = "CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.amountRials')), '0') AS DECIMAL(20,0))";
    const [registered, completed, checkoutRow, purchaseRow] = await Promise.all([
      this.users.createQueryBuilder('u')
        .where('u.createdAt >= :since', { since })
        .getCount(),
      this.users.createQueryBuilder('u')
        .where('u.createdAt >= :since', { since })
        .andWhere('u.isCompleted = :completed', { completed: true })
        .getCount(),
      this.events.createQueryBuilder('e')
        .innerJoin('e.user', 'u')
        .select('COUNT(DISTINCT e.userId)', 'buyers')
        .addSelect(`COALESCE(SUM(${amountExpr}), 0)`, 'revenue')
        .addSelect('COUNT(*)', 'transactions')
        .where('e.type = :type', { type: EventType.CREDITS_SPENT })
        .andWhere(`${reasonExpr} LIKE :reason`, { reason: 'buy:%' })
        .andWhere('e.createdAt >= :since', { since })
        .andWhere('u.createdAt >= :since', { since })
        .getRawOne(),
      this.events.createQueryBuilder('e')
        .innerJoin('e.user', 'u')
        .select('COUNT(DISTINCT e.userId)', 'buyers')
        .addSelect(`COALESCE(SUM(${amountExpr}), 0)`, 'revenue')
        .addSelect('COUNT(*)', 'transactions')
        .where('e.type = :type', { type: EventType.PURCHASE })
        .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.isCommercialPurchase')) = 'true'")
        .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.currency')) = 'IRT'")
        .andWhere('e.createdAt >= :since', { since })
        .andWhere('u.createdAt >= :since', { since })
        .getRawOne(),
    ]);

    const checkoutBuyers = finite(checkoutRow?.buyers);
    const completedBuyers = finite(purchaseRow?.buyers);
    const completedRevenue = Math.round(finite(purchaseRow?.revenue));
    const rate = (value: number) =>
      registered > 0 ? Math.round((value / registered) * 10000) / 100 : 0;

    return {
      currency: 'IRT',
      unit: 'rial',
      periodDays: days,
      steps: [
        { step: 'registered', users: registered, revenue: 0, conversionRate: 100 },
        { step: 'profile_completed', users: completed, revenue: 0, conversionRate: rate(completed) },
        {
          step: 'wallet_checkout_debited',
          users: checkoutBuyers,
          revenue: Math.round(finite(checkoutRow?.revenue)),
          conversionRate: rate(checkoutBuyers),
          transactions: finite(checkoutRow?.transactions),
        },
        {
          step: 'purchase_fulfilled',
          users: completedBuyers,
          revenue: completedRevenue,
          conversionRate: rate(completedBuyers),
          transactions: finite(purchaseRow?.transactions),
        },
      ],
      note: 'purchase_fulfilled includes successfully granted commercial bundles paid by wallet, card or crypto. wallet_checkout_debited is a separate wallet-only step and may exceed fulfilled purchases when fulfillment failed.',
    };
  }

  async concentration(_depositCurrency: PaymentCurrency = 'IRT', days = 365) {
    const amountExpr = "CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.amountRials')), '0') AS DECIMAL(20,0))";
    const rows = await this.events.createQueryBuilder('e')
      .select('e.userId', 'userId')
      .addSelect(`SUM(${amountExpr})`, 'revenue')
      .where('e.type = :type', { type: EventType.PURCHASE })
      .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.isCommercialPurchase')) = 'true'")
      .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.currency')) = 'IRT'")
      .andWhere('e.createdAt >= :since', { since: sinceDays(days) })
      .groupBy('e.userId')
      .orderBy(`SUM(${amountExpr})`, 'DESC')
      .getRawMany();

    const values = rows.map(row => finite(row.revenue)).filter(value => value >= 0).sort((a, b) => a - b);
    const total = values.reduce((sum, value) => sum + value, 0);
    const top = (pct: number) => {
      const count = Math.ceil(values.length * pct);
      const revenue = values.slice(-count).reduce((sum, value) => sum + value, 0);
      return { users: count, revenue: Math.round(revenue), share: total > 0 ? Math.round((revenue / total) * 10000) / 100 : 0 };
    };
    const n = values.length;
    const weighted = values.reduce((sum, value, index) => sum + (index + 1) * value, 0);
    const giniCoefficient = n > 0 && total > 0 ? Math.max(0, Math.min(1, (2 * weighted) / (n * total) - (n + 1) / n)) : 0;
    return {
      currency: 'IRT',
      unit: 'rial',
      periodDays: days,
      source: 'successfully fulfilled commercial bundle purchase events; includes wallet, card and crypto checkout',
      payingUsers: n,
      totalRevenue: Math.round(total),
      top1pct: top(0.01),
      top5pct: top(0.05),
      top10pct: top(0.10),
      giniCoefficient: Math.round(giniCoefficient * 10000) / 10000,
    };
  }

  async vipChurn(days = 30) {
    const now = new Date();
    const since = sinceDays(days);
    const [activeVipUsers, recentlyExpiredUsers, totalVipUsers] = await Promise.all([
      this.vips.createQueryBuilder('v').select('COUNT(DISTINCT v.userId)', 'count')
        .where('v.active = :active', { active: true }).andWhere('v.expiresAt > :now', { now }).getRawOne(),
      this.vips.createQueryBuilder('v').select('COUNT(DISTINCT v.userId)', 'count')
        .where('v.expiresAt >= :since', { since }).andWhere('v.expiresAt < :now', { now }).getRawOne(),
      this.vips.createQueryBuilder('v').select('COUNT(DISTINCT v.userId)', 'count').getRawOne(),
    ]);
    const active = finite(activeVipUsers?.count);
    const expired = finite(recentlyExpiredUsers?.count);
    return {
      periodDays: days,
      activeVipUsers: active,
      recentlyExpiredVipUsers: expired,
      usersWithVipHistory: finite(totalVipUsers?.count),
      expiryRate: active + expired > 0 ? Math.round((expired / (active + expired)) * 10000) / 100 : 0,
      revenueMetricsAvailable: false,
      lostRevenue: null,
      recoveredRevenue: null,
      expansionRevenue: null,
      netRevenueRetention: null,
      history: [],
      limitation: 'UserVip currently stores userId, active and expiresAt only; it has no source payment, plan price, currency or renewal record. Revenue churn/NRR cannot be calculated truthfully until subscription lifecycle events are linked to payments.',
    };
  }

  async mrr(currency: PaymentCurrency = 'IRT') {
    const since = sinceDays(30);
    const reasonExpr = "JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.reason'))";
    const amountExpr = "CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.amountRials')), '0') AS DECIMAL(20,0))";
    const [depositRevenue, checkoutDebit, fulfilledSales, activeVip] = await Promise.all([
      this.payments.createQueryBuilder('p').select('COALESCE(SUM(p.amount), 0)', 'revenue')
        .where('p.status = :status', { status: 'paid' }).andWhere('p.productCode = :productCode', { productCode: 'wallet_charge' }).andWhere('p.currency = :currency', { currency })
        .andWhere('COALESCE(p.confirmedAt, p.createdAt) >= :since', { since }).getRawOne(),
      this.events.createQueryBuilder('e').select(`COALESCE(SUM(${amountExpr}), 0)`, 'revenue')
        .where('e.type = :type', { type: EventType.CREDITS_SPENT })
        .andWhere(`${reasonExpr} LIKE :reason`, { reason: 'buy:%' })
        .andWhere('e.createdAt >= :since', { since }).getRawOne(),
      this.events.createQueryBuilder('e').select(`COALESCE(SUM(${amountExpr}), 0)`, 'revenue')
        .addSelect('COUNT(*)', 'purchaseCount')
        .where('e.type = :type', { type: EventType.PURCHASE })
        .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.isCommercialPurchase')) = 'true'")
        .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.currency')) = 'IRT'")
        .andWhere('e.createdAt >= :since', { since }).getRawOne(),
      this.vips.createQueryBuilder('v').select('COUNT(DISTINCT v.userId)', 'count')
        .where('v.active = :active', { active: true }).andWhere('v.expiresAt > :now', { now: new Date() }).getRawOne(),
    ]);
    return {
      currency: 'IRT',
      unit: 'rial',
      depositCurrency: currency,
      depositUnit: currencyUnit(currency),
      mrr: null,
      arr: null,
      mrrGrowth: null,
      mrrHistory: [],
      recurringRevenueAvailable: false,
      grossRevenue30d: Math.round(finite(depositRevenue?.revenue)),
      walletDeposits30d: Math.round(finite(depositRevenue?.revenue)),
      walletDebits30d: Math.round(finite(checkoutDebit?.revenue)),
      grossSales30d: Math.round(finite(fulfilledSales?.revenue)),
      fulfilledPurchaseCount30d: finite(fulfilledSales?.purchaseCount),
      activeVipUsers: finite(activeVip?.count),
      limitation: 'MRR/ARR require subscription plan, period, price, currency and renewal linkage. Wallet deposits, checkout debits, fulfilled wallet-funded bundle sales and active VIP counts are shown as separate factual measures; one-time events are not treated as recurring revenue.',
    };
  }

  async forecastAccuracy(history: { date: string; amount: number }[], currency: PaymentCurrency = 'IRT') {
    if (history.length < 15) {
      return { dataAvailable: false, mape: null, rmse: null, lastEvaluatedAt: null, history: [], evaluationMethod: '7-day rolling mean backtest', reason: 'At least 15 daily observations are required.' };
    }
    const evaluations: { date: string; predicted: number; actual: number; error: number }[] = [];
    for (let i = 7; i < history.length; i++) {
      const window = history.slice(i - 7, i);
      const predicted = window.reduce((sum, point) => sum + finite(point.amount), 0) / 7;
      const actual = finite(history[i].amount);
      evaluations.push({ date: history[i].date, predicted: Math.round(predicted), actual: Math.round(actual), error: Math.round(actual - predicted) });
    }
    const nonZero = evaluations.filter(row => row.actual !== 0);
    const mape = nonZero.length > 0 ? nonZero.reduce((sum, row) => sum + Math.abs(row.error / row.actual), 0) / nonZero.length * 100 : null;
    const rmse = Math.sqrt(evaluations.reduce((sum, row) => sum + row.error ** 2, 0) / evaluations.length);
    return {
      dataAvailable: true,
      currency,
      mape: mape === null ? null : Math.round(mape * 100) / 100,
      rmse: Math.round(rmse * 100) / 100,
      lastEvaluatedAt: new Date().toISOString(),
      history: evaluations.slice(-30),
      evaluationMethod: '7-day rolling mean backtest over observed daily paid revenue; MAPE excludes zero-actual days.',
      evaluationSamples: evaluations.length,
    };
  }
 
  /**
   * RFM segmentation from successfully fulfilled commercial IRT bundle purchases.
   * Frequency and monetary value use the selected window; recency uses lifetime
   * purchase history so dormant historical buyers are not mistaken for prospects.
   */
  async customerSegments(days = 90) {
    if (!Number.isInteger(days) || days < 30 || days > 3650) {
      throw new Error('days must be an integer between 30 and 3650');
    }

    const since = sinceDays(days);
    const amountExpr =
      "CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.amountRials')), '0') AS DECIMAL(20,0))";
    const purchaseRows = await this.events
      .createQueryBuilder('e')
      .innerJoin('e.user', 'customer')
      .select('e.userId', 'userId')
      .addSelect(
        'SUM(CASE WHEN e.createdAt >= :since THEN 1 ELSE 0 END)',
        'frequency',
      )
      .addSelect('COUNT(*)', 'lifetimeFrequency')
      .addSelect('MAX(e.createdAt)', 'lastPurchaseAt')
      .addSelect(
        `SUM(CASE WHEN e.createdAt >= :since THEN ${amountExpr} ELSE 0 END)`,
        'monetaryRials',
      )
      .where('e.type = :purchaseType', { purchaseType: EventType.PURCHASE })
      .andWhere('customer.status = :activeStatus', { activeStatus: 'active' })
      .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.isCommercialPurchase')) = 'true'")
      .andWhere("JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.currency')) = 'IRT'")
      .andWhere(`${amountExpr} > 0`)
      .andWhere('e.createdAt <= :now', { now: new Date() })
      .setParameter('since', since)
      .groupBy('e.userId')
      .getRawMany();

    // First-purchase eligibility is lifetime-based, not window-based. This
    // prevents a previous buyer with no recent transaction from being treated
    // as a new prospect.
    const neverPurchasedActiveUsers = await this.users
      .createQueryBuilder('customer')
      .leftJoin(
        PartitionedEvent,
        'purchase',
        `purchase.userId = customer.id
          AND purchase.type = :purchaseType
          AND JSON_UNQUOTE(JSON_EXTRACT(purchase.metadata, '$.isCommercialPurchase')) = 'true'`,
        { purchaseType: EventType.PURCHASE },
      )
      .where('customer.status = :activeStatus', { activeStatus: 'active' })
      .andWhere('purchase.id IS NULL')
      .getCount();

    const definitions = [
      { key: 'frequent_active', rule: `3+ purchases in ${days} days; last purchase within 30 days` },
      { key: 'frequent_at_risk', rule: `3+ purchases in ${days} days; last purchase more than 30 days ago` },
      { key: 'repeat_active', rule: `2 purchases in ${days} days; last purchase within 30 days` },
      { key: 'repeat_at_risk', rule: `2 purchases in ${days} days; last purchase more than 30 days ago` },
      { key: 'single_purchase_window_active', rule: `1 purchase in ${days} days; last purchase within 30 days` },
      { key: 'single_purchase_window_lapsed', rule: `1 purchase in ${days} days; last purchase more than 30 days ago` },
      { key: 'historical_dormant', rule: `0 purchases in ${days} days; at least 1 successful commercial purchase before the window` },
    ] as const;

    type SegmentKey = (typeof definitions)[number]['key'];
    type MonetaryTier = 'M1' | 'M2' | 'M3' | 'M4';
    type MonetaryBucket = { customers: number; revenueRials: number };
    type SegmentStats = {
      customers: number;
      purchases: number;
      revenueRials: number;
      monetaryTiers: Record<MonetaryTier, MonetaryBucket>;
    };
    const emptyMonetaryTiers = (): Record<MonetaryTier, MonetaryBucket> => ({
      M1: { customers: 0, revenueRials: 0 },
      M2: { customers: 0, revenueRials: 0 },
      M3: { customers: 0, revenueRials: 0 },
      M4: { customers: 0, revenueRials: 0 },
    });
    const grouped = Object.fromEntries(
      definitions.map(({ key }) => [
        key,
        {
          customers: 0,
          purchases: 0,
          revenueRials: 0,
          monetaryTiers: emptyMonetaryTiers(),
        },
      ]),
    ) as Record<SegmentKey, SegmentStats>;

    const isValidRow = (row: any): boolean => {
      const userId = Number(row.userId);
      const frequency = Math.trunc(finite(row.frequency));
      const lifetimeFrequency = Math.trunc(finite(row.lifetimeFrequency));
      const monetaryRials = finite(row.monetaryRials);
      const lastPurchase = new Date(row.lastPurchaseAt);
      return (
        Number.isSafeInteger(userId) &&
        userId > 0 &&
        lifetimeFrequency > 0 &&
        frequency >= 0 &&
        frequency <= lifetimeFrequency &&
        Number.isFinite(lastPurchase.getTime()) &&
        Number.isFinite(monetaryRials) &&
        monetaryRials >= 0 &&
        (frequency === 0 || monetaryRials > 0)
      );
    };
    const validRows = purchaseRows.filter(isValidRow);
    const invalidRows = purchaseRows.length - validRows.length;

    // Monetary tiers are data-derived quartiles among active IRT purchasers in
    // this window. Equal amounts share the same tier; ties are never split.
    const monetaryValues = validRows
      .filter((row) => Math.trunc(finite(row.frequency)) > 0)
      .map((row) => finite(row.monetaryRials))
      .sort((a, b) => a - b);
    const quantile = (p: number): number | null => {
      if (monetaryValues.length === 0) return null;
      const position = (monetaryValues.length - 1) * p;
      const lower = Math.floor(position);
      const upper = Math.ceil(position);
      if (lower === upper) return monetaryValues[lower];
      const fraction = position - lower;
      return monetaryValues[lower] + (monetaryValues[upper] - monetaryValues[lower]) * fraction;
    };
    const monetaryCutoffs = {
      p25: quantile(0.25),
      p50: quantile(0.5),
      p75: quantile(0.75),
    };
    const resolveMonetaryTier = (amount: number): MonetaryTier => {
      if (monetaryCutoffs.p25 === null || amount <= monetaryCutoffs.p25) return 'M1';
      if (monetaryCutoffs.p50 !== null && amount <= monetaryCutoffs.p50) return 'M2';
      if (monetaryCutoffs.p75 !== null && amount <= monetaryCutoffs.p75) return 'M3';
      return 'M4';
    };

    let activePurchasedInWindow = 0;
    let periodPurchases = 0;
    let periodRevenueRials = 0;
    let lifetimeRepeatBuyers = 0;
    let lifetimeFrequentBuyers = 0;
    let topQuartileAtRiskBuyers = 0;

    for (const row of validRows) {
      const frequency = Math.trunc(finite(row.frequency));
      const lifetimeFrequency = Math.trunc(finite(row.lifetimeFrequency));
      const monetaryRials = finite(row.monetaryRials);
      const lastPurchase = new Date(row.lastPurchaseAt);
      const recencyDays = Math.max(
        0,
        Math.floor((Date.now() - lastPurchase.getTime()) / 86_400_000),
      );
      const segment: SegmentKey =
        frequency === 0
          ? 'historical_dormant'
          : frequency >= 3
            ? recencyDays <= 30
              ? 'frequent_active'
              : 'frequent_at_risk'
            : frequency === 2
              ? recencyDays <= 30
                ? 'repeat_active'
                : 'repeat_at_risk'
              : recencyDays <= 30
                ? 'single_purchase_window_active'
                : 'single_purchase_window_lapsed';

      grouped[segment].customers += 1;
      grouped[segment].purchases += frequency;
      grouped[segment].revenueRials += monetaryRials;
      periodPurchases += frequency;
      periodRevenueRials += monetaryRials;
      if (frequency > 0) {
        activePurchasedInWindow += 1;
        const tier = resolveMonetaryTier(monetaryRials);
        grouped[segment].monetaryTiers[tier].customers += 1;
        grouped[segment].monetaryTiers[tier].revenueRials += monetaryRials;
        if (tier === 'M4' && (segment === 'frequent_at_risk' || segment === 'repeat_at_risk')) {
          topQuartileAtRiskBuyers += 1;
        }
      }
      if (lifetimeFrequency >= 2) lifetimeRepeatBuyers += 1;
      if (lifetimeFrequency >= 3) lifetimeFrequentBuyers += 1;
    }

    const previouslyPurchasedUsers = validRows.length;
    return {
      currency: 'IRT',
      unit: 'rial',
      periodDays: days,
      source:
        "active users' PURCHASE events with isCommercialPurchase=true, currency=IRT and positive amountRials; written after bundle fulfilment succeeds",
      metrics: {
        activePreviouslyPurchasedCustomers: previouslyPurchasedUsers,
        activePurchasedInWindow,
        historicalDormantBuyers: grouped.historical_dormant.customers,
        purchasesInWindow: periodPurchases,
        fulfilledRevenueRialsInWindow: Math.round(periodRevenueRials),
        lifetimeRepeatBuyers,
        lifetimeFrequentBuyers,
        topQuartileAtRiskBuyers,
        activeNeverPurchasedUsers: neverPurchasedActiveUsers,
        invalidAggregateRows: invalidRows,
      },
      segments: definitions.map(({ key, rule }) => ({
        key,
        rule,
        ...grouped[key],
        revenueRials: Math.round(grouped[key].revenueRials),
        monetaryTiers: Object.fromEntries(
          Object.entries(grouped[key].monetaryTiers).map(([tier, bucket]) => [
            tier,
            {
              customers: bucket.customers,
              revenueRials: Math.round(bucket.revenueRials),
            },
          ]),
        ),
      })),
      monetaryQuartiles: {
        unit: 'rial',
        p25: monetaryCutoffs.p25 === null ? null : Math.round(monetaryCutoffs.p25),
        p50: monetaryCutoffs.p50 === null ? null : Math.round(monetaryCutoffs.p50),
        p75: monetaryCutoffs.p75 === null ? null : Math.round(monetaryCutoffs.p75),
        definition:
          'per-customer fulfilled commercial purchase sum in the selected window; quartiles are calculated only among active-window purchasers; tied amounts remain together in the lower tier',
      },
      protection: {
        previouslyPurchasedUsersExcludedFromFirstPurchaseDiscounts: true,
        previouslyPurchasedUsersProtected: previouslyPurchasedUsers,
        repeatBuyersProtected: lifetimeRepeatBuyers,
        firstPurchaseCandidatePool: neverPurchasedActiveUsers,
        eligibilityRule:
          'active account with no lifetime successfully fulfilled commercial PURCHASE event; past purchasers remain excluded even when they have no purchase in the selected window',
        status: 'analytics_only_no_discount_is_applied',
      },
      rfmDefinitions: {
        recency: 'whole days since the latest lifetime successfully fulfilled commercial purchase',
        frequency: `number of successfully fulfilled commercial purchases in the selected rolling ${days}-day window`,
        monetary: 'sum of amountRials on purchases in the selected window, kept in IRT only',
        monetaryTiers: 'M1-M4 based on empirical 25th, 50th and 75th percentiles; equal monetary amounts are never split',
        recencyRiskBoundaryDays: 30,
        frequentPurchaseThresholdInWindow: 3,
      },
    };
  }}
