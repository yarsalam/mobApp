import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThan, Not, Repository } from 'typeorm';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { User } from 'src/users/entities/user.entity';
import { Interaction } from 'src/interaction/entities/interaction.entity';
import { Message } from 'src/message/entities/message.entity';
import { Payment } from 'src/payments/entities/payment.entity';
import { Report } from 'src/report-block/entities/report.entity';
import { ModerationLog } from 'src/moderation/entities/moderation-log.entity';

@Controller('admin-api/intelligence')
@UseGuards(AdminApiGuard)
export class IntelligenceSnapshotController {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Interaction)
    private readonly interactionRepo: Repository<Interaction>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Report) private readonly reportRepo: Repository<Report>,
    @InjectRepository(ModerationLog)
    private readonly modRepo: Repository<ModerationLog>,
  ) {}

  @Get('raw-snapshot')
  async getRawSnapshot() {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    // ── helpers ────────────────────────────────────────────────────────────
    const safe = <T>(p: Promise<T>, fallback: T): Promise<T> =>
      p.catch(() => fallback);
    // دقیقاً N روز پیش
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
    // یک روز کامل که N روز پیش بوده (برای cohort واقعی)
    const cohortDay = (days: number): [Date, Date] => {
      const base = ago(days);
      const start = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
      );
      const end = new Date(start.getTime() + 86_400_000);
      return [start, end];
    };
    const cohortWindow = (days: number, width = 3): [Date, Date] => {
      const start = new Date(now.getTime() - (days + width) * 86_400_000);
      const end = new Date(now.getTime() - days * 86_400_000);
      return [start, end];
    };

    // ✅ D7 و D30 با Window (بازه ۳ روزه) — Retention واقعی میده
    const [d7s, d7e] = cohortWindow(7);
    const [d30s, d30e] = cohortWindow(30);

    // ✅ D14, D60, D90 با Day (تک‌روز) — توی داشبورد استفاده نمیشه
    const [d14s, d14e] = cohortDay(14);
    const [d60s, d60e] = cohortDay(60);
    const [d90s, d90e] = cohortDay(90);

    const [
      // ── کاربران ──
      totalActiveUsers,
      dauCount,
      dauYesterdayCount, // ✅ رفع: بین ۴۸h تا ۲۴h پیش
      mauCount,
      mauPrevCount, // ✅ رفع: بین ۶۰ تا ۳۰ روز پیش (مستقل)
      newToday,
      newThisWeek,
      // ── جنسیت ──
      genderCounts,
      activeGenderCounts,
      verifiedFemaleCount,
      newFemaleThisWeek,
      // ── Cohort Retention واقعی ──
      cohort7dBase,
      cohort7dReturned, // ✅ رفع: فقط کاربران ثبت‌نام روز ۷ام
      cohort14dBase,
      cohort14dReturned,
      cohort30dBase,
      cohort30dReturned,
      cohort60dBase,
      cohort60dReturned,
      cohort90dBase,
      cohort90dReturned,
      // ── Female Retention (cohort واقعی) ──
      femaleRetention7dBase,
      femaleRetention7dReturned,
      femaleRetention30dBase,
      femaleRetention30dReturned,
      // ── Premium/Free Retention ──
      premiumRetention30dBase,
      premiumRetention30dReturned,
      freeRetention30dBase,
      freeRetention30dReturned,
      // ── Active Female/Male با بازه‌های مستقل ──
      activeFemale7d, // ✅ رفع: هفته جاری
      activeFemalePrev7d, // ✅ رفع: هفته قبل (مستقل)
      activeMale7d,
      activeMalePrev7d,
      // ── Phase / Tier ──
      phaseCounts,
      tierCounts,
      // ── Interaction ──
      likesLast30d,
      matchesLast30d,
      mutualLikesLast30d,
      femaleMatchReceivers,
      activeFemaleBase,
      // ── Message ──
      conversationPairCount,
      singleMessagePairCount,
      replyStats,
      avgMsgPerPair,
      // ── Funnel ──
      signups30d,
      completedProfiles30d,
      withPhotos30d,
      firstLikers30d,
      firstMatchReceivers30d,
      firstChatters30d,
      // ── Revenue ──
      revenueThisMonth,
      revenueLastMonth,
      revenue7d,
      revenuePrev7d,
      premiumUserCount,
      payingUserCount,
      // ── Safety ──
      reportsToday,
      pendingModeration,
      blockedToday,
      fakeProfileCount,
      verifiedAllCount,
      highRiskCount,
      // ── Extras ──
      peakHourResult,
      avgReplyMinutesResult,
      unansweredLikesCount,
      ghostedPairCount,
      maleRetention7dBase,
      maleRetention7dReturned,
      maleRetention30dBase,
      maleRetention30dReturned,
      meaningfulConversations30d,
    ] = await Promise.all([
      // ── کاربران ──────────────────────────────────────────────────────────
      safe(this.userRepo.count({ where: { status: 'active' } }), 0),

      // DAU: در ۲۴h اخیر فعال بوده
      safe(
        this.userRepo.count({
          where: { lastActive: MoreThan(ago(1)), status: 'active' },
        }),
        0,
      ),

      // ✅ DAU دیروز واقعی: بین ۴۸h و ۲۴h پیش
      safe(
        this.userRepo.count({
          where: { lastActive: Between(ago(2), ago(1)), status: 'active' },
        }),
        0,
      ),

      // MAU
      safe(
        this.userRepo.count({
          where: { lastActive: MoreThan(ago(30)), status: 'active' },
        }),
        0,
      ),

      // ✅ MAU ماه قبل: بین ۶۰ و ۳۰ روز پیش (مستقل از MAU جاری)
      safe(
        this.userRepo.count({
          where: { lastActive: Between(ago(60), ago(30)), status: 'active' },
        }),
        0,
      ),

      safe(this.userRepo.count({ where: { createdAt: MoreThan(ago(1)) } }), 0),
      safe(this.userRepo.count({ where: { createdAt: MoreThan(ago(7)) } }), 0),

      // ── جنسیت ────────────────────────────────────────────────────────────
      safe(
        this.userRepo
          .createQueryBuilder('u')
          .select('u.gender', 'gender')
          .addSelect('COUNT(*)', 'cnt')
          .where('u.status = :s', { s: 'active' })
          .groupBy('u.gender')
          .getRawMany(),
        [],
      ),

      safe(
        this.userRepo
          .createQueryBuilder('u')
          .select('u.gender', 'gender')
          .addSelect('COUNT(*)', 'cnt')
          .where('u.lastActive > :d', { d: ago(30) })
          .andWhere('u.status = :s', { s: 'active' })
          .groupBy('u.gender')
          .getRawMany(),
        [],
      ),

      safe(
        this.userRepo.count({
          where: { gender: 'female', isFaceVerified: true, status: 'active' },
        }),
        0,
      ),

      safe(
        this.userRepo.count({
          where: { gender: 'female', createdAt: MoreThan(ago(7)) },
        }),
        0,
      ),

      // ── ✅ Cohort Retention واقعی — فقط کاربران ثبت‌نام روز دقیق ──────────
      // D7
      safe(this.userRepo.count({ where: { createdAt: Between(d7s, d7e) } }), 0),

      safe(
        this.userRepo.count({
          where: { createdAt: Between(d7s, d7e), lastActive: MoreThan(ago(1)) },
        }),
        0,
      ),
      // D14
      safe(
        this.userRepo.count({ where: { createdAt: Between(d14s, d14e) } }),
        0,
      ),

      safe(
        this.userRepo.count({
          where: {
            createdAt: Between(d14s, d14e),
            lastActive: MoreThan(ago(1)),
          },
        }),
        0,
      ),
      // D30
      safe(
        this.userRepo.count({ where: { createdAt: Between(d30s, d30e) } }),
        0,
      ),
      safe(
        this.userRepo.count({
          where: {
            createdAt: Between(d30s, d30e),
            lastActive: MoreThan(ago(1)),
          },
        }),
        0,
      ),
      // D60
      safe(
        this.userRepo.count({ where: { createdAt: Between(d60s, d60e) } }),
        0,
      ),
      safe(
        this.userRepo.count({
          where: {
            createdAt: Between(d60s, d60e),
            lastActive: MoreThan(ago(1)),
          },
        }),
        0,
      ),
      // D90
      safe(
        this.userRepo.count({ where: { createdAt: Between(d90s, d90e) } }),
        0,
      ),
      safe(
        this.userRepo.count({
          where: {
            createdAt: Between(d90s, d90e),
            lastActive: MoreThan(ago(1)),
          },
        }),
        0,
      ),

      // ── Female cohort retention ───────────────────────────────────────────
      safe(
        this.userRepo.count({
          where: { gender: 'female', createdAt: Between(d7s, d7e) },
        }),
        0,
      ),
      safe(
        this.userRepo.count({
          where: {
            gender: 'female',
            createdAt: Between(d7s, d7e),
            lastActive: MoreThan(ago(1)),
          },
        }),
        0,
      ),
      safe(
        this.userRepo.count({
          where: { gender: 'female', createdAt: Between(d30s, d30e) },
        }),
        0,
      ),
      safe(
        this.userRepo.count({
          where: {
            gender: 'female',
            createdAt: Between(d30s, d30e),
            lastActive: MoreThan(ago(1)),
          },
        }),
        0,
      ),

      // ── Premium/Free cohort retention ────────────────────────────────────
      safe(
        this.userRepo.count({
          where: { tier: Not('free') as any, createdAt: Between(d30s, d30e) },
        }),
        0,
      ),
      safe(
        this.userRepo.count({
          where: {
            tier: Not('free') as any,
            createdAt: Between(d30s, d30e),
            lastActive: MoreThan(ago(1)),
          },
        }),
        0,
      ),
      safe(
        this.userRepo.count({
          where: { tier: 'free' as any, createdAt: Between(d30s, d30e) },
        }),
        0,
      ),
      safe(
        this.userRepo.count({
          where: {
            tier: 'free' as any,
            createdAt: Between(d30s, d30e),
            lastActive: MoreThan(ago(1)),
          },
        }),
        0,
      ),

      // ── ✅ Active gender با بازه‌های مستقل ──────────────────────────────
      // هفته جاری (0-7 روز پیش)
      safe(
        this.userRepo.count({
          where: {
            gender: 'female',
            lastActive: MoreThan(ago(7)),
            status: 'active',
          },
        }),
        0,
      ),
      // ✅ هفته قبل (7-14 روز پیش — مجزا از هفته جاری)
      safe(
        this.userRepo.count({
          where: {
            gender: 'female',
            lastActive: Between(ago(14), ago(7)),
            status: 'active',
          },
        }),
        0,
      ),
      safe(
        this.userRepo.count({
          where: {
            gender: 'male',
            lastActive: MoreThan(ago(7)),
            status: 'active',
          },
        }),
        0,
      ),
      safe(
        this.userRepo.count({
          where: {
            gender: 'male',
            lastActive: Between(ago(14), ago(7)),
            status: 'active',
          },
        }),
        0,
      ),

      // ── Phase / Tier ──────────────────────────────────────────────────────
      safe(
        this.userRepo
          .createQueryBuilder('u')
          .select('u.phase', 'phase')
          .addSelect('COUNT(*)', 'cnt')
          .where('u.status = :s', { s: 'active' })
          .groupBy('u.phase')
          .getRawMany(),
        [],
      ),

      safe(
        this.userRepo
          .createQueryBuilder('u')
          .select('u.tier', 'tier')
          .addSelect('COUNT(*)', 'cnt')
          .where('u.status = :s', { s: 'active' })
          .groupBy('u.tier')
          .getRawMany(),
        [],
      ),

      // ── Interaction ───────────────────────────────────────────────────────
      safe(
        this.interactionRepo.count({
          where: { type: 'like', createdAt: MoreThan(ago(30)) },
        }),
        0,
      ),
      safe(
        this.interactionRepo.count({
          where: { type: 'match', createdAt: MoreThan(ago(30)) },
        }),
        0,
      ),
      safe(
        this.interactionRepo.count({
          where: { type: 'match', createdAt: MoreThan(ago(30)) },
        }),
        0,
      ),

      safe(
        this.interactionRepo
          .createQueryBuilder('i')
          .innerJoin('i.receiver', 'u')
          .where('i.type = :t', { t: 'match' })
          .andWhere('i.createdAt > :d', { d: ago(30) })
          .andWhere('u.gender = :g', { g: 'female' })
          .select('COUNT(DISTINCT u.id)', 'cnt')
          .getRawOne(),
        { cnt: '0' },
      ),

      safe(
        this.userRepo.count({
          where: {
            gender: 'female',
            lastActive: MoreThan(ago(7)),
            status: 'active',
          },
        }),
        0,
      ),

      // ── Message ───────────────────────────────────────────────────────────
      safe(
        this.messageRepo
          .createQueryBuilder('m')
          .select(
            "COUNT(DISTINCT CONCAT(LEAST(m.from_id,m.to_id),'-',GREATEST(m.from_id,m.to_id)))",
            'pairs',
          )
          .where('m.created_at > :d', { d: ago(30) })
          .getRawOne(),
        { pairs: '0' },
      ),

      safe(this.countSingleMessagePairs(ago(30)), 0),

      safe(
        this.messageRepo
          .createQueryBuilder('m')
          .select([
            'COUNT(*) as total',
            'SUM(CASE WHEN m.read_at IS NOT NULL THEN 1 ELSE 0 END) as readCount',
          ])
          .where('m.created_at > :d', { d: ago(30) })
          .getRawOne(),
        { total: '0', readCount: '0' },
      ),

      safe(
        this.messageRepo
          .createQueryBuilder('m')
          .select([
            "CONCAT(LEAST(m.from_id,m.to_id),'-',GREATEST(m.from_id,m.to_id)) as pair",
            'COUNT(*) as msgCount',
          ])
          .where('m.created_at > :d', { d: ago(30) })
          .groupBy('pair')
          .getRawMany(),
        [],
      ),

      // ── Funnel ────────────────────────────────────────────────────────────
      safe(this.userRepo.count({ where: { createdAt: MoreThan(ago(30)) } }), 0),
      safe(
        this.userRepo.count({
          where: { createdAt: MoreThan(ago(30)), isCompleted: true },
        }),
        0,
      ),

      safe(
        this.userRepo
          .createQueryBuilder('u')
          .innerJoin('u.userImages', 'img')
          .where('u.createdAt > :d', { d: ago(30) })
          .select('COUNT(DISTINCT u.id)', 'cnt')
          .getRawOne(),
        { cnt: '0' },
      ),

      safe(
        this.interactionRepo
          .createQueryBuilder('i')
          .innerJoin('i.sender', 'u')
          .where('u.createdAt > :d', { d: ago(30) })
          .andWhere('i.type = :t', { t: 'like' })
          .select('COUNT(DISTINCT u.id)', 'cnt')
          .getRawOne(),
        { cnt: '0' },
      ),

      safe(
        this.interactionRepo
          .createQueryBuilder('i')
          .innerJoin('i.receiver', 'u')
          .where('u.createdAt > :d', { d: ago(30) })
          .andWhere('i.type = :t', { t: 'match' })
          .select('COUNT(DISTINCT u.id)', 'cnt')
          .getRawOne(),
        { cnt: '0' },
      ),

      safe(
        this.messageRepo
          .createQueryBuilder('m')
          .innerJoin(User, 'u', 'u.id = m.from_id')
          .where('u.createdAt > :d', { d: ago(30) })
          .select('COUNT(DISTINCT m.from_id)', 'cnt')
          .getRawOne(),
        { cnt: '0' },
      ),

      // ── Revenue ───────────────────────────────────────────────────────────
      safe(
        this.paymentRepo
          .createQueryBuilder('p')
          .select('SUM(p.amount)', 'total')
          .where('p.status = :s', { s: 'paid' })
          .andWhere('p.createdAt >= :d', { d: startThisMonth })
          .getRawOne(),
        { total: '0' },
      ),

      safe(
        this.paymentRepo
          .createQueryBuilder('p')
          .select('SUM(p.amount)', 'total')
          .where('p.status = :s', { s: 'paid' })
          .andWhere('p.createdAt >= :from', { from: startLastMonth })
          .andWhere('p.createdAt < :to', { to: endLastMonth })
          .getRawOne(),
        { total: '0' },
      ),

      // Revenue 7d (هفته جاری)
      safe(
        this.paymentRepo
          .createQueryBuilder('p')
          .select('SUM(p.amount)', 'total')
          .where('p.status = :s', { s: 'paid' })
          .andWhere('p.createdAt > :d', { d: ago(7) })
          .getRawOne(),
        { total: '0' },
      ),

      // ✅ Revenue هفته قبل (مستقل)
      safe(
        this.paymentRepo
          .createQueryBuilder('p')
          .select('SUM(p.amount)', 'total')
          .where('p.status = :s', { s: 'paid' })
          .andWhere('p.createdAt BETWEEN :from AND :to', {
            from: ago(14),
            to: ago(7),
          })
          .getRawOne(),
        { total: '0' },
      ),

      safe(
        this.userRepo
          .createQueryBuilder('u')
          .where('u.tier != :t', { t: 'free' })
          .andWhere('u.status = :s', { s: 'active' })
          .getCount(),
        0,
      ),

      safe(
        this.paymentRepo
          .createQueryBuilder('p')
          .where('p.status = :s', { s: 'paid' })
          .select('COUNT(DISTINCT p.userId)', 'cnt')
          .getRawOne(),
        { cnt: '0' },
      ),

      // ── Safety ────────────────────────────────────────────────────────────
      safe(
        this.reportRepo.count({ where: { createdAt: MoreThan(startOfToday) } }),
        0,
      ),
      safe(this.modRepo.count({ where: { isSafe: false } as any }), 0),
      safe(
        this.userRepo.count({ where: { blockedAt: MoreThan(startOfToday) } }),
        0,
      ),
      safe(
        this.userRepo
          .createQueryBuilder('u')
          .where('u.trustScore < :t', { t: 30 })
          .andWhere('u.isFaceVerified = false')
          .andWhere('u.status = :s', { s: 'active' })
          .getCount(),
        0,
      ),
      safe(
        this.userRepo.count({
          where: { isFaceVerified: true, status: 'active' },
        }),
        0,
      ),
      safe(
        this.userRepo
          .createQueryBuilder('u')
          .where('u.trustScore < :t', { t: 20 })
          .andWhere('u.status = :s', { s: 'active' })
          .getCount(),
        0,
      ),

      // ── Extras ────────────────────────────────────────────────────────────
      safe(
        this.userRepo
          .createQueryBuilder('u')
          .select('HOUR(u.lastActive)', 'hour')
          .addSelect('COUNT(*)', 'cnt')
          .where('u.lastActive > :d', { d: ago(7) })
          .groupBy('hour')
          .orderBy('cnt', 'DESC')
          .limit(1)
          .getRawOne(),
        { hour: '21' },
      ),

      safe(
        this.messageRepo
          .createQueryBuilder('m')
          .select(
            'AVG(TIMESTAMPDIFF(MINUTE, m.created_at, fr.created_at))',
            'avgMinutes',
          )
          .leftJoin(
            'message',
            'fr',
            'fr.from_id = m.to_id AND fr.to_id = m.from_id AND fr.created_at > m.created_at',
          )
          .where('m.created_at > :d', { d: ago(30) })
          .getRawOne(),
        { avgMinutes: '0' },
      ),
      safe(
        this.interactionRepo
          .createQueryBuilder('i')
          .where('i.type = :t', { t: 'like' })
          .andWhere('i.createdAt > :d', { d: ago(30) })
          .andWhere(
            'NOT EXISTS (SELECT 1 FROM interaction i2 WHERE i2.sender_id = i.receiver_id AND i2.receiver_id = i.sender_id AND i2.type = :t2)',
            { t2: 'like' },
          )
          .getCount(),
        0,
      ),

      // 🆕 گفتگوهای ghosted (فقط ۱ پیام و بیش از ۷۲ ساعت گذشته)
      safe(
        this.messageRepo
          .createQueryBuilder('m')
          .select(
            "CONCAT(LEAST(m.from_id,m.to_id),'-',GREATEST(m.from_id,m.to_id))",
            'pair',
          )
          .where('m.created_at > :d', { d: ago(30) })
          .groupBy('pair')
          .having('COUNT(*) = 1')
          .andHaving('MAX(m.created_at) < :ghosted', {
            ghosted: new Date(now.getTime() - 72 * 86_400_000),
          })
          .getCount(),
        0,
      ),

      // 🆕 Male Retention D7
      safe(
        this.userRepo.count({
          where: { gender: 'male', createdAt: Between(d7s, d7e) },
        }),
        0,
      ),
      safe(
        this.userRepo.count({
          where: {
            gender: 'male',
            createdAt: Between(d7s, d7e),
            lastActive: MoreThan(ago(1)),
          },
        }),
        0,
      ),

      // 🆕 Male Retention D30
      safe(
        this.userRepo.count({
          where: { gender: 'male', createdAt: Between(d30s, d30e) },
        }),
        0,
      ),
      safe(
        this.userRepo.count({
          where: {
            gender: 'male',
            createdAt: Between(d30s, d30e),
            lastActive: MoreThan(ago(1)),
          },
        }),
        0,
      ),

      // مکالمه معنادار: جفت‌هایی که هر دو طرف ≥۳ پیام فرستاده‌اند، در ۳۰ روز اخیر
      safe(
        this.messageRepo
          .query(
            `
    SELECT COUNT(*) AS cnt FROM (
      SELECT
        LEAST(from_id, to_id)   AS a,
        GREATEST(from_id, to_id) AS b,
        SUM(CASE WHEN from_id = LEAST(from_id, to_id)    THEN 1 ELSE 0 END) AS msgs_a,
        SUM(CASE WHEN from_id = GREATEST(from_id, to_id) THEN 1 ELSE 0 END) AS msgs_b
      FROM message
      WHERE created_at > ?
      GROUP BY a, b
      HAVING msgs_a >= 3 AND msgs_b >= 3
    ) t
    `,
            [ago(30)],
          )
          .then((r: any[]) => parseInt(r?.[0]?.cnt ?? '0', 10)),
        0,
      ),
    ]);

    // ── ✅ helper محاسبه retention با محافظت از تقسیم بر صفر ───────────────
    const retention = (returned: number, base: number) =>
      base > 0 ? Math.round((returned / base) * 100) : 0;

    return {
      totalActiveUsers,
      dauCount,
      dauYesterdayCount,
      mauCount,
      mauPrevCount,
      newToday,
      newThisWeek,
      genderCounts,
      activeGenderCounts,
      verifiedFemaleCount,
      newFemaleThisWeek,
      unansweredLikesCount,
      ghostedPairCount,
      maleRetention7dBase,
      maleRetention7dReturned,
      maleRetention30dBase,
      maleRetention30dReturned,
      meaningfulConversations30d, // ← نام متغیری که به Promise.all دادی

      // Cohort Retention (درصد آماده — نه base/returned خام)
      retentionD7: retention(cohort7dReturned, cohort7dBase),
      retentionD14: retention(cohort14dReturned, cohort14dBase),
      retentionD30: retention(cohort30dReturned, cohort30dBase),
      retentionD60: retention(cohort60dReturned, cohort60dBase),
      retentionD90: retention(cohort90dReturned, cohort90dBase),

      femaleRetentionD7: retention(
        femaleRetention7dReturned,
        femaleRetention7dBase,
      ),
      femaleRetentionD30: retention(
        femaleRetention30dReturned,
        femaleRetention30dBase,
      ),
      premiumRetentionD30: retention(
        premiumRetention30dReturned,
        premiumRetention30dBase,
      ),
      freeRetentionD30: retention(
        freeRetention30dReturned,
        freeRetention30dBase,
      ),

      activeFemale7d,
      activeFemalePrev7d,
      activeMale7d,
      activeMalePrev7d,

      phaseCounts,
      tierCounts,
      likesLast30d,
      matchesLast30d,
      mutualLikesLast30d,
      femaleMatchReceivers: parseInt(
        (femaleMatchReceivers as any)?.cnt || '0',
        10,
      ),
      activeFemaleBase,
      conversationPairCount: parseInt(
        (conversationPairCount as any)?.pairs || '0',
        10,
      ),
      singleMessagePairCount,
      replyStats,
      avgMsgPerPair,

      signups30d,
      completedProfiles30d,
      withPhotos30d: (withPhotos30d as any)?.cnt || '0',
      firstLikers30d: (firstLikers30d as any)?.cnt || '0',
      firstMatchReceivers30d: (firstMatchReceivers30d as any)?.cnt || '0',
      firstChatters30d: (firstChatters30d as any)?.cnt || '0',

      revenueThisMonth: (revenueThisMonth as any)?.total || '0',
      revenueLastMonth: (revenueLastMonth as any)?.total || '0',
      revenue7d: (revenue7d as any)?.total || '0',
      revenuePrev7d: (revenuePrev7d as any)?.total || '0',
      premiumUserCount,
      payingUserCount: parseInt((payingUserCount as any)?.cnt || '0', 10),

      reportsToday,
      pendingModeration,
      blockedToday,
      fakeProfileCount,
      verifiedAllCount,
      highRiskCount,

      peakHour: (peakHourResult as any)?.hour || '21',
      avgReplyMinutes: (avgReplyMinutesResult as any)?.avgMinutes || '0',
    };
  }

  private async countSingleMessagePairs(since: Date): Promise<number> {
    const rows = await this.messageRepo
      .createQueryBuilder('m')
      .select(
        "CONCAT(LEAST(m.from_id,m.to_id),'-',GREATEST(m.from_id,m.to_id))",
        'pair',
      )
      .addSelect('COUNT(*)', 'cnt')
      .where('m.created_at > :since', { since })
      .groupBy('pair')
      .having('COUNT(*) = 1')
      .getRawMany();
    return rows.length;
  }
}
