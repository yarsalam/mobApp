import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserEventService } from '../user-event/user-event.service';
import { Report } from 'src/report-block/entities/report.entity';
import { DevicePhoneService } from 'src/auth/device-phone/device-phone.service';
import { EventType } from 'src/user-event/type/event-type.enum';

export interface TrustContext {
  /** ۰–۱۰۰: اعتماد کلی کاربر (هویت، رفتار، سابقه) */
  trustScore: number;
  /** ۰–۱۰۰: ریسک دستگاه (چند حساب روی یک دستگاه، چند دستگاه روی یک شماره) */
  deviceRisk: number;
}

@Injectable()
export class TrustScoreService {
  private readonly logger = new Logger(TrustScoreService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,

    private readonly userEventService: UserEventService,
    private readonly devicePhoneService: DevicePhoneService,
  ) {}

  /**
   * محاسبه امتیاز اعتماد کاربر (۰–۱۰۰)
   * پاسخ می‌دهد: آیا این کاربر واقعی و سالم است؟
   */
  async calculateTrustScore(userId: number): Promise<number> {
    let score = 50;

    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['phones', 'userImages'],
    });

    if (!user) return 0;

    // ۱. تأیید شماره تلفن
    if (user.phones?.some((p) => p.isVerified)) score += 10;

    // ۲. تعداد عکس
    const images = user.userImages ?? [];
    if (images.length >= 3) score += 10;
    else if (images.length > 0) score += 5;

    // ۳. تأیید چهره
    if (user.isVerified) score += 20;

    // ۴. سن اکانت (هر ۱۰ روز = ۱ امتیاز، حداکثر ۱۰)
    const accountAgeDays = Math.floor(
      (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    score += Math.min(10, accountAgeDays / 10);

    // ۵. گزارش‌ها (هر گزارش ۵ امتیاز کم می‌کند)
    const reportCount = await this.reportRepo.count({
      where: { reportedUser: { id: userId } },
    });
    score -= reportCount * 5;

    // ۶. رفتار مثبت در رویدادها
    const events = await this.userEventService.getUserEvents(userId, {
      limit: 100,
    });
    const positiveEvents = events.filter((e) =>
      [EventType.LIKE, EventType.MESSAGE_SENT, EventType.MATCH].includes(
        e.type,
      ),
    ).length;
    score += Math.min(15, positiveEvents / 10);

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * محاسبه ریسک دستگاه (۰–۱۰۰)
   * ریسک بالا = یک دستگاه با چند حساب، یا یک شماره روی چند دستگاه
   *
   * پاسخ می‌دهد: آیا این الگوی ثبت‌نام مشکوک است؟
   */
  async calculateDeviceRisk(userId: number): Promise<number> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['phones'],
    });

    if (!user || !user.phones?.length) return 50; // بدون شماره → ریسک متوسط

    let riskScore = 0;

    for (const phoneRecord of user.phones) {
      const phone = phoneRecord.phone;
      if (!phone) continue;

      // چند دستگاه از یک شماره استفاده کرده‌اند؟
      const devicesPerPhone =
        await this.devicePhoneService.countUniqueDevices(phone);

      // DevicePhoneService.countUniquePhones نیاز به deviceId دارد —
      // آن را از user.devices بگیریم اگر موجود باشد.
      // اگر موجود نبود، فقط از شاخص devicesPerPhone استفاده می‌کنیم.
      if (devicesPerPhone >= 5) riskScore += 50;
      else if (devicesPerPhone >= 3) riskScore += 30;
      else if (devicesPerPhone >= 2) riskScore += 10;
    }

    return Math.min(100, riskScore);
  }

  /**
   * دریافت هر دو شاخص trust و deviceRisk با هم (برای Paywall)
   */
  async getTrustContext(userId: number): Promise<TrustContext> {
    const [trustScore, deviceRisk] = await Promise.all([
      this.calculateTrustScore(userId),
      this.calculateDeviceRisk(userId),
    ]);

    return { trustScore, deviceRisk };
  }

  // ─── متدهای کمکی که قبلاً وجود داشتند ───────────────────────────────────

  async getWeightedSuggestions(userId: number, candidates: any[]) {
    return candidates.map((c) => ({
      ...c,
      trustScore: c.user?.trustScore || 50,
      finalScore: c.score * (1 + (c.user?.trustScore || 50) / 100),
    }));
  }

  async applyTrustToBoost(
    userId: number,
    boostFactor: number,
  ): Promise<number> {
    const trustScore = await this.calculateTrustScore(userId);
    return boostFactor * (1 + trustScore / 100);
  }

  async getSEOBenefit(userId: number): Promise<number> {
    const trustScore = await this.calculateTrustScore(userId);
    if (trustScore > 80) return 1.5;
    if (trustScore > 50) return 1.2;
    return 1;
  }

  async shouldAutoBlock(userId: number): Promise<boolean> {
    return false;
  }

  async adminOverride(userId: number, score: number, reason: string) {
    await this.userRepo.update(userId, { trustScore: score });
    return { userId, score, reason, overriddenAt: new Date() };
  }
}
