import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentCurrency } from '../payments/entities/payment.entity';
import { User } from '../users/entities/user.entity';
import { UserVip } from '../payments/vip/entities/vip.entity';

const CURRENCIES: PaymentCurrency[] = ['IRT', 'USDT', 'BTC', 'USD'];

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
    case 'USD': return 'cent';
  }
}

@Injectable()
export class RevenueAnalyticsService {
  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserVip) private readonly vips: Repository<UserVip>,
  ) {}

  async byGender(currency: PaymentCurrency = 'IRT', days = 90) {
    const rows = await this.payments.createQueryBuilder('p')
      .innerJoin('p.user', 'u')
      .select('u.gender', 'gender')
      .addSelect('SUM(p.amount)', 'revenue')
      .addSelect('COUNT(*)', 'paymentCount')
      .addSelect('COUNT(DISTINCT p.userId)', 'payingUsers')
      .where('p.status = :status', { status: 'paid' })
      .andWhere('p.currency = :currency', { currency })
      .andWhere('COALESCE(p.confirmedAt, p.createdAt) >= :since', { since: sinceDays(days) })
      .groupBy('u.gender')
      .getRawMany();

    const result = {
      male: { revenue: 0, payingUsers: 0, paymentCount: 0, arppu: 0 },
      female: { revenue: 0, payingUsers: 0, paymentCount: 0, arppu: 0 },
      unknown: { revenue: 0, payingUsers: 0, paymentCount: 0, arppu: 0 },
    };

    for (const row of rows) {
      const key = classifyGender(row.gender);
      result[key].revenue += finite(row.revenue);
      result[key].payingUsers += finite(row.payingUsers);
      result[key].paymentCount += finite(row.paymentCount);
    }

    for (const row of Object.values(result)) {
      row.revenue = Math.round(row.revenue);
      row.arppu = row.payingUsers > 0 ? Math.round(row.revenue / row.payingUsers) : 0;
    }

    return {
      currency,
      unit: currencyUnit(currency),
      periodDays: days,
      source: 'payments.status=paid; payments.confirmedAt',
      ...result,
      total: {
        revenue: result.male.revenue + result.female.revenue + result.unknown.revenue,
        payingUsers: result.male.payingUsers + result.female.payingUsers + result.unknown.payingUsers,
        paymentCount: result.male.paymentCount + result.female.paymentCount + result.unknown.paymentCount,
      },
    };
  }

  async byProduct(currency: PaymentCurrency = 'IRT', days = 90) {
    const productExpr = "COALESCE(NULLIF(TRIM(p.productType), ''), NULLIF(TRIM(p.productCode), ''), NULLIF(TRIM(p.productId), ''), 'unclassified')";
    const rows = await this.payments.createQueryBuilder('p')
      .select(productExpr, 'product')
      .addSelect('SUM(p.amount)', 'revenue')
      .addSelect('COUNT(*)', 'transactionCount')
      .addSelect('COUNT(DISTINCT p.userId)', 'payingUsers')
      .where('p.status = :status', { status: 'paid' })
      .andWhere('p.currency = :currency', { currency })
      .andWhere('COALESCE(p.confirmedAt, p.createdAt) >= :since', { since: sinceDays(days) })
      .groupBy(productExpr)
      .orderBy('SUM(p.amount)', 'DESC')
      .getRawMany();

    const total = rows.reduce((sum, row) => sum + finite(row.revenue), 0);
    return {
      currency,
      unit: currencyUnit(currency),
      periodDays: days,
      totalRevenue: Math.round(total),
      rows: rows.map(row => ({
        product: String(row.product ?? 'unclassified'),
        revenue: Math.round(finite(row.revenue)),
        share: total > 0 ? Math.round((finite(row.revenue) / total) * 10000) / 100 : 0,
        transactionCount: finite(row.transactionCount),
        payingUsers: finite(row.payingUsers),
      })),
    };
  }

  async arppu(currency: PaymentCurrency = 'IRT', days = 30) {
    const since = sinceDays(days);
    const [revenueRow, payerRow, activeUsers] = await Promise.all([
      this.payments.createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'revenue')
        .addSelect('COUNT(*)', 'paymentCount')
        .where('p.status = :status', { status: 'paid' })
        .andWhere('p.currency = :currency', { currency })
        .andWhere('COALESCE(p.confirmedAt, p.createdAt) >= :since', { since })
        .getRawOne(),
      this.payments.createQueryBuilder('p')
        .select('COUNT(DISTINCT p.userId)', 'payingUsers')
        .where('p.status = :status', { status: 'paid' })
        .andWhere('p.currency = :currency', { currency })
        .andWhere('COALESCE(p.confirmedAt, p.createdAt) >= :since', { since })
        .getRawOne(),
      this.users.createQueryBuilder('u')
        .where('u.status = :status', { status: 'active' })
        .andWhere('u.lastActive >= :since', { since })
        .getCount(),
    ]);

    const totalRevenue = Math.round(finite(revenueRow?.revenue));
    const payingUsers = finite(payerRow?.payingUsers);
    return {
      currency,
      unit: currencyUnit(currency),
      periodDays: days,
      totalRevenue,
      paymentCount: finite(revenueRow?.paymentCount),
      payingUsers,
      activeUsers: activeUsers,
      arppu: payingUsers > 0 ? Math.round(totalRevenue / payingUsers) : 0,
      payingRate: activeUsers > 0 ? Math.round((payingUsers / activeUsers) * 10000) / 100 : 0,
      definition: 'payingUsers = distinct users with paid payments in period; activeUsers = active accounts active in period',
    };
  }

  async cohort(currency: PaymentCurrency = 'IRT', months = 12) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const rows = await this.users.createQueryBuilder('u')
      .leftJoin('u.payments', 'p', 'p.status = :status AND p.currency = :currency AND COALESCE(p.confirmedAt, p.createdAt) >= u.createdAt', {
        status: 'paid',
        currency,
      })
      .select("DATE_FORMAT(u.createdAt, '%Y-%m')", 'cohort')
      .addSelect('COUNT(DISTINCT u.id)', 'users')
      .addSelect("SUM(CASE WHEN COALESCE(p.confirmedAt, p.createdAt) < DATE_ADD(u.createdAt, INTERVAL 30 DAY) THEN p.amount ELSE 0 END)", 'revenue30d')
      .addSelect("SUM(CASE WHEN COALESCE(p.confirmedAt, p.createdAt) < DATE_ADD(u.createdAt, INTERVAL 60 DAY) THEN p.amount ELSE 0 END)", 'revenue60d')
      .addSelect("SUM(CASE WHEN COALESCE(p.confirmedAt, p.createdAt) < DATE_ADD(u.createdAt, INTERVAL 90 DAY) THEN p.amount ELSE 0 END)", 'revenue90d')
      .addSelect("SUM(CASE WHEN COALESCE(p.confirmedAt, p.createdAt) < DATE_ADD(u.createdAt, INTERVAL 180 DAY) THEN p.amount ELSE 0 END)", 'revenue180d')
      .where('u.createdAt >= :since', { since })
      .groupBy("DATE_FORMAT(u.createdAt, '%Y-%m')")
      .orderBy('cohort', 'ASC')
      .getRawMany();

    const now = Date.now();
    return {
      currency,
      unit: currencyUnit(currency),
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

  async funnel(currency: PaymentCurrency = 'IRT', days = 30) {
    const since = sinceDays(days);
    const [registered, completed, payerRow, revenueRow] = await Promise.all([
      this.users.createQueryBuilder('u').where('u.createdAt >= :since', { since }).getCount(),
      this.users.createQueryBuilder('u').where('u.createdAt >= :since', { since })
        .andWhere('u.isCompleted = :completed', { completed: true }).getCount(),
      this.payments.createQueryBuilder('p').innerJoin('p.user', 'u').select('COUNT(DISTINCT p.userId)', 'users')
        .where('p.status = :status', { status: 'paid' }).andWhere('p.currency = :currency', { currency })
        .andWhere('u.createdAt >= :since', { since }).andWhere('COALESCE(p.confirmedAt, p.createdAt) >= :since', { since }).getRawOne(),
      this.payments.createQueryBuilder('p').innerJoin('p.user', 'u').select('COALESCE(SUM(p.amount), 0)', 'revenue')
        .where('p.status = :status', { status: 'paid' }).andWhere('p.currency = :currency', { currency })
        .andWhere('u.createdAt >= :since', { since }).andWhere('COALESCE(p.confirmedAt, p.createdAt) >= :since', { since }).getRawOne(),
    ]);
    const payingUsers = finite(payerRow?.users);
    const revenue = Math.round(finite(revenueRow?.revenue));
    const rate = (value: number) => registered > 0 ? Math.round((value / registered) * 10000) / 100 : 0;
    return {
      currency,
      unit: currencyUnit(currency),
      periodDays: days,
      steps: [
        { step: 'registered', users: registered, revenue: 0, conversionRate: 100 },
        { step: 'profile_completed', users: completed, revenue: 0, conversionRate: rate(completed) },
        { step: 'paid_user', users: payingUsers, revenue, conversionRate: rate(payingUsers) },
      ],
      note: 'Payment conversion is based on confirmed paid payments in selected currency; profile completion is based on users.isCompleted.',
    };
  }

  async concentration(currency: PaymentCurrency = 'IRT', days = 365) {
    const rows = await this.payments.createQueryBuilder('p')
      .select('p.userId', 'userId')
      .addSelect('SUM(p.amount)', 'revenue')
      .where('p.status = :status', { status: 'paid' })
      .andWhere('p.currency = :currency', { currency })
      .andWhere('COALESCE(p.confirmedAt, p.createdAt) >= :since', { since: sinceDays(days) })
      .groupBy('p.userId')
      .orderBy('SUM(p.amount)', 'DESC')
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
      currency,
      unit: currencyUnit(currency),
      periodDays: days,
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
    const [grossRevenue, activeVip] = await Promise.all([
      this.payments.createQueryBuilder('p').select('COALESCE(SUM(p.amount), 0)', 'revenue')
        .where('p.status = :status', { status: 'paid' }).andWhere('p.currency = :currency', { currency })
        .andWhere('COALESCE(p.confirmedAt, p.createdAt) >= :since', { since }).getRawOne(),
      this.vips.createQueryBuilder('v').select('COUNT(DISTINCT v.userId)', 'count')
        .where('v.active = :active', { active: true }).andWhere('v.expiresAt > :now', { now: new Date() }).getRawOne(),
    ]);
    return {
      currency,
      unit: currencyUnit(currency),
      mrr: null,
      arr: null,
      mrrGrowth: null,
      mrrHistory: [],
      recurringRevenueAvailable: false,
      grossRevenue30d: Math.round(finite(grossRevenue?.revenue)),
      activeVipUsers: finite(activeVip?.count),
      limitation: 'Payments do not store subscription plan, service period or renewal linkage, and UserVip does not reference its source payment. Gross paid revenue and active VIP counts are reported separately; MRR/ARR are not inferred from one-time receipts.',
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
}
