import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import jalaliday from 'jalaliday';
import dayjs from 'dayjs';
import { Payment, PaymentCurrency } from 'src/payments/entities/payment.entity';

dayjs.extend(jalaliday);

export interface MonthlyRevenuePoint {
  month: string; // برچسب فارسی شمسی، مثلا «فروردین ۱۴۰۴»
  jy: number;
  jm: number;
  currency: PaymentCurrency;
  amount: number;
  paymentCount: number;
}

const JALALI_MONTH_NAMES = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

function toPersianDigits(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/**
 * RevenueTrendService
 *
 * جایگزین mock موجود در AdminApiRevenueController.monthly().
 * درآمد واقعی را از جدول payments می‌خواند و بر اساس ماه شمسی گروه‌بندی می‌کند.
 *
 * فقط پرداخت‌های status='paid' حساب می‌شوند — pending/failed نباید
 * در نمودار درآمد ماهانه دیده شوند، وگرنه عدد گمراه‌کننده است.
 */
@Injectable()
export class RevenueTrendService {
  private readonly logger = new Logger(RevenueTrendService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
  ) {}

  /**
   * درآمد ماهانه (شمسی) برای N ماه اخیر.
   * پیش‌فرض ۱۲ ماه — کافی برای نمودار روند سالانه.
   */
  async getMonthlyTrend(
    monthsBack = 12,
    currency: PaymentCurrency = 'IRT',
  ): Promise<MonthlyRevenuePoint[]> {
    const since = new Date();
    since.setMonth(since.getMonth() - monthsBack);

    // گروه‌بندی به تفکیک روز در DB انجام می‌شود (سبک‌تر از خواندن همه ردیف‌ها)،
    // سپس تجمیع به ماه شمسی در حافظه صورت می‌گیرد چون MySQL native
    // نمی‌تواند تقویم جلالی را محاسبه کند.
    const rows: { day: string; amount: string; cnt: string }[] =
      await this.paymentRepo
        .createQueryBuilder('p')
        .select('DATE(p.createdAt)', 'day')
        .addSelect('SUM(p.amount)', 'amount')
        .addSelect('COUNT(*)', 'cnt')
        .where('p.status = :status', { status: 'paid' })
        .andWhere('p.currency = :currency', { currency })
        .andWhere('p.createdAt >= :since', { since })
        .groupBy('DATE(p.createdAt)')
        .getRawMany();

    const buckets = new Map<string, MonthlyRevenuePoint>();

    for (const row of rows) {
      const d = new Date(row.day);
      const jDate = dayjs(d).calendar('jalali');
      const jy = jDate.year();
      const jm = jDate.month() + 1; // dayjs ماه را ۰-بیس می‌دهد
      const key = `${jy}-${jm}`;

      const existing = buckets.get(key);
      const amount = parseFloat(row.amount) || 0;
      const cnt = parseInt(row.cnt, 10) || 0;

      if (existing) {
        existing.amount += amount;
        existing.paymentCount += cnt;
      } else {
        buckets.set(key, {
          month: `${JALALI_MONTH_NAMES[jm - 1]} ${toPersianDigits(jy)}`,
          jy,
          jm,
          currency,
          amount,
          paymentCount: cnt,
        });
      }
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.jy - b.jy || a.jm - b.jm)
      .map((p) => ({ ...p, amount: Math.round(p.amount) }));
  }

  /**
   * جایگزین historical() — سری روزانه‌ی خام برای مصارفی مثل forecast
   * که به grain روزانه نیاز دارند، نه ماهانه.
   */
  async getDailyHistory(
    daysBack = 90,
    currency: PaymentCurrency = 'IRT',
  ): Promise<{ date: string; amount: number }[]> {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    const rows: { day: string; amount: string }[] = await this.paymentRepo
      .createQueryBuilder('p')
      .select('DATE(p.createdAt)', 'day')
      .addSelect('SUM(p.amount)', 'amount')
      .where('p.status = :status', { status: 'paid' })
      .andWhere('p.currency = :currency', { currency })
      .andWhere('p.createdAt >= :since', { since })
      .groupBy('DATE(p.createdAt)')
      .orderBy('day', 'ASC')
      .getRawMany();

    const byDate = new Map(
      rows.map((r) => [String(r.day).slice(0, 10), Number(r.amount) || 0]),
    );

    const result: { date: string; amount: number }[] = [];

    for (let offset = daysBack - 1; offset >= 0; offset--) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - offset);

      const key = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');

      result.push({
        date: key,
        amount: Math.round(byDate.get(key) ?? 0),
      });
    }

    return result;
  }
}
