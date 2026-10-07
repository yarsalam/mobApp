import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { PartitionedEvent } from '../entities/partitioned-event.entity';
import { EventType } from '../type/event-type.enum';
import { User } from 'src/users/entities/user.entity';

export interface ChurnRiskEntry {
  userId: number;
  nickname?: string;
  risk: number;
  appOpens7d: number;
  likes7d: number;
  messages7d: number;
}

export interface ChurnSummary {
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  avgRisk: number;
  sampleSize: number;
}

const RECENT_WINDOW_DAYS = 7;
// جمعیت مورد بررسی: کاربرانی که حداقل یک رخداد در ۶۰ روز اخیر داشته‌اند.
// کاربری که کلاً ۶۰+ روزه هیچ فعالیتی نداشته "در معرض ریزش" نیست، از قبل ریزش کرده.
const LOOKBACK_WINDOW_DAYS = 60;

@Injectable()
export class ChurnPredictorService {
  private readonly logger = new Logger(ChurnPredictorService.name);

  constructor(
    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** ریسک ریزش یک کاربر مشخص (۰ تا ۱) — برای صفحه‌ی جزئیات یک کاربر */
  async predictChurnRisk(userId: number): Promise<number> {
    const sevenDaysAgo = new Date(
      Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const recentEvents = await this.eventRepo.find({
      where: { userId, createdAt: MoreThan(sevenDaysAgo) },
    });

    if (recentEvents.length === 0) {
      return 0.9;
    }

    const appOpens = recentEvents.filter(
      (e) => e.type === EventType.APP_OPEN,
    ).length;
    const likes = recentEvents.filter((e) => e.type === EventType.LIKE).length;
    const messages = recentEvents.filter(
      (e) => e.type === EventType.MESSAGE_SENT,
    ).length;

    return this.calculateRiskFromCounts(appOpens, likes, messages);
  }

  /** لیست کاربران با ریسک بالاتر از threshold، نزولی مرتب‌شده */
  async getAtRiskUsers(
    threshold = 0.7,
    limit = 100,
  ): Promise<ChurnRiskEntry[]> {
    const scored = await this.scoreActiveUsers();
    return scored
      .filter((r) => r.risk >= threshold)
      .sort((a, b) => b.risk - a.risk)
      .slice(0, limit);
  }

  /** توزیع ریسک روی کل جمعیت فعال — برای کارت‌های خلاصه‌ی داشبورد */
  async getChurnSummary(): Promise<ChurnSummary> {
    const scored = await this.scoreActiveUsers();
    if (scored.length === 0) {
      return {
        highRisk: 0,
        mediumRisk: 0,
        lowRisk: 0,
        avgRisk: 0,
        sampleSize: 0,
      };
    }

    let highRisk = 0;
    let mediumRisk = 0;
    let lowRisk = 0;
    let sum = 0;

    for (const r of scored) {
      sum += r.risk;
      if (r.risk >= 0.7) highRisk++;
      else if (r.risk >= 0.5) mediumRisk++;
      else lowRisk++;
    }

    return {
      highRisk,
      mediumRisk,
      lowRisk,
      avgRisk: Math.round((sum / scored.length) * 1000) / 1000,
      sampleSize: scored.length,
    };
  }

  // ── private ────────────────────────────────────────────────────────────────

  /**
   * محاسبه‌ی دسته‌ای ریسک برای همه‌ی کاربران فعال — یک کوئری گروهی،
   * بدون N+1 (برخلاف اجرای predictChurnRisk برای هر کاربر جداگانه).
   */
  private async scoreActiveUsers(): Promise<ChurnRiskEntry[]> {
    const sevenDaysAgo = new Date(
      Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const lookbackDate = new Date(
      Date.now() - LOOKBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    try {
      const rows = await this.eventRepo
        .createQueryBuilder('e')
        .innerJoin(User, 'u', 'u.id = e.userId')
        .select('e.userId', 'userId')
        .addSelect('u.nickname', 'nickname')
        .addSelect(
          'SUM(CASE WHEN e.type = :appOpen AND e.createdAt > :sevenDaysAgo THEN 1 ELSE 0 END)',
          'appOpens7d',
        )
        .addSelect(
          'SUM(CASE WHEN e.type = :like AND e.createdAt > :sevenDaysAgo THEN 1 ELSE 0 END)',
          'likes7d',
        )
        .addSelect(
          'SUM(CASE WHEN e.type = :message AND e.createdAt > :sevenDaysAgo THEN 1 ELSE 0 END)',
          'messages7d',
        )
        .where('u.status = :status', { status: 'active' })
        .andWhere('e.createdAt > :lookbackDate', { lookbackDate })
        .setParameters({
          appOpen: EventType.APP_OPEN,
          like: EventType.LIKE,
          message: EventType.MESSAGE_SENT,
          sevenDaysAgo,
        })
        .groupBy('e.userId')
        .addGroupBy('u.nickname')
        .getRawMany();

      return rows.map((r) => {
        const appOpens7d = Number(r.appOpens7d) || 0;
        const likes7d = Number(r.likes7d) || 0;
        const messages7d = Number(r.messages7d) || 0;

        return {
          userId: Number(r.userId),
          nickname: r.nickname ?? undefined,
          risk: this.calculateRiskFromCounts(appOpens7d, likes7d, messages7d),
          appOpens7d,
          likes7d,
          messages7d,
        };
      });
    } catch (exc: unknown) {
      const message = exc instanceof Error ? exc.message : String(exc);
      this.logger.error(`scoreActiveUsers failed: ${message}`);
      return [];
    }
  }

  /** فرمول واحد ریسک — هم predictChurnRisk هم scoreActiveUsers از این استفاده می‌کنن */
  private calculateRiskFromCounts(
    appOpens7d: number,
    likes7d: number,
    messages7d: number,
  ): number {
    let risk = 0.5;
    if (appOpens7d < 3) risk += 0.2;
    if (likes7d < 2) risk += 0.15;
    if (messages7d === 0) risk += 0.2;
    return Math.round(Math.min(1, risk) * 1000) / 1000;
  }
}
