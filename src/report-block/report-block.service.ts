import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Block } from './entities/block.entity';
import { Report, ReportStatus } from './entities/report.entity';
import { CreateReportDto } from './dto/create-report.dto';
import { UserEventService } from '../user-event/user-event.service';
import { RedisService } from '../redis/redis.service';
import { TrustScoreService } from 'src/trust/trust-score.service';
import { User } from 'src/users/entities/user.entity';
import { FeatureStoreService } from 'src/feature-store/feature-store.service';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class ReportBlockService {
  private readonly logger = new Logger(ReportBlockService.name);

  constructor(
    @InjectRepository(Block)
    private readonly blockRepo: Repository<Block>,

    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,

    private readonly userEventService: UserEventService,
    private readonly featureStore: FeatureStoreService,
    private readonly trustScoreService: TrustScoreService,

    private readonly redis: RedisService,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async blockUser(userId: number, targetId: number) {
    console.log('userId,targetId', userId, targetId);
    const exists = await this.blockRepo.findOne({
      where: { user: { id: userId }, targetUser: { id: targetId } },
    });
    console.log('exists', userId, targetId);
    if (exists) return exists;

    const blockCountKey = `block:count:${userId}`;
    console.log('blockCountKey', userId, targetId);
    const count = parseInt((await this.redis.get(blockCountKey)) || '0');
    if (count >= 10) {
      throw new BadRequestException(
        'شما نمی‌توانید بیش از ۵ بار در ۲۴ ساعت بلاک کنید',
      );
    }
    await this.redis.incr(blockCountKey);
    if (count === 0) {
      await this.redis.expire(blockCountKey, 86400); // 24 ساعت
    }

    const block = this.blockRepo.create({
      user: { id: userId },
      targetUser: { id: targetId },
    });
    console.log('block', block);
    const saved = await this.blockRepo.save(block);
    console.log('saved', saved);
    await this.redis.del(`relation:${userId}:${targetId}`);
    await this.redis.del(`relation:${targetId}:${userId}`);
    // 🆕 لاگ رویداد
    await this.userEventService.log({
      userId,
      type: EventType.USER_BLOCKED, // باید در EventType وجود داشته باشد
      targetUserId: targetId,
      metadata: { source: 'manual' },
    });

    // 🆕 (اختیاری) یادگیری وزن‌ها
    await this.featureStore.learnFeatureWeights(userId, 'block');

    return saved;
  }

  async unblockUser(userId: number, targetId: number) {
    const block = await this.blockRepo.findOne({
      where: { user: { id: userId }, targetUser: { id: targetId } },
    });

    if (!block) return { deleted: false };

    await this.blockRepo.remove(block);

    await this.redis.del(`relation:${userId}:${targetId}`);
    await this.redis.del(`relation:${targetId}:${userId}`);

    await this.userEventService.log({
      userId,
      type: EventType.USER_UNBLOCKED,
      targetUserId: targetId,
      metadata: { source: 'manual' },
    });

    return { deleted: true };
  }

  async reportUser(dto: CreateReportDto) {
    // ۱. چک وجود گزارش قبلی
    const existing = await this.reportRepo.findOne({
      where: {
        reporter: { id: dto.reporterId },
        reportedUser: { id: dto.reportedUserId },
      },
      order: { createdAt: 'DESC' },
    });

    if (existing) {
      // بروزرسانی
      existing.reason = dto.reason;
      existing.message = dto.message ?? existing.message;
      existing.status = ReportStatus.PENDING; // برگشت به صف بررسی
      await this.reportRepo.save(existing);

      if (dto.blockUser) {
        await this.blockUser(dto.reporterId, dto.reportedUserId);
      }

      await this.userEventService.log({
        userId: dto.reporterId,
        type: EventType.USER_REPORTED,
        targetUserId: dto.reportedUserId,
        metadata: { reportId: existing.id, reason: dto.reason, isUpdate: true },
      });

      return existing;
    }

    // ۲. اعتبارسنجی (فقط برای گزارش جدید)
    const isValid = await this.validateReport(
      dto.reporterId,
      dto.reportedUserId,
    );
    if (!isValid) {
      throw new BadRequestException('گزارش معتبر نیست یا محدودیت روزانه دارید');
    }

    // ۳. ایجاد گزارش جدید
    const report = this.reportRepo.create({
      reporter: { id: dto.reporterId },
      reportedUser: { id: dto.reportedUserId },
      reason: dto.reason,
      message: dto.message,
      messageId: dto.messageId,
      status: ReportStatus.PENDING,
    });
    const saved = await this.reportRepo.save(report);

    if (dto.blockUser) {
      await this.blockUser(dto.reporterId, dto.reportedUserId);
    }

    await this.userEventService.log({
      userId: dto.reporterId,
      type: EventType.USER_REPORTED,
      targetUserId: dto.reportedUserId,
      metadata: {
        reportId: saved.id,
        reason: dto.reason,
        hasBlock: dto.blockUser,
      },
    });

    // ۴. auto-block
    const shouldBlock = await this.trustScoreService.shouldAutoBlock(
      dto.reportedUserId,
    );
    if (shouldBlock) {
      await this.autoBlockUser(dto.reportedUserId);
    }

    return saved;
  }

  async confirmReport(reportId: number, adminId: string) {
    const report = await this.reportRepo.findOne({
      where: { id: reportId },
      relations: ['reporter', 'reportedUser'],
    });

    if (!report) {
      throw new Error('Report not found');
    }

    report.confirmed = true;
    report.confirmedBy = adminId;
    report.confirmedAt = new Date();

    await this.reportRepo.save(report);

    // به‌روزرسانی trust score
    await this.trustScoreService.calculateTrustScore(report.reportedUser.id);
    await this.redis.del(`trust:${report.reportedUser.id}`);

    // لاگ
    await this.userEventService.log({
      userId: report.reporter.id,
      type: EventType.REPORT_CONFIRMED,
      targetUserId: report.reportedUser.id,
      metadata: {
        reportId,
        reason: report.reason,
        adminId,
      },
    });

    return report;
  }

  async getReports(
    status?: 'pending' | 'confirmed' | 'rejected',
  ): Promise<Report[]> {
    const where: any = {};
    if (status) where.status = status;

    return this.reportRepo.find({
      where,
      relations: ['reporter', 'reportedUser'],
      order: { createdAt: 'DESC' },
    });
  }

  async isBlocked(userId: number, targetId: number): Promise<boolean> {
    const found = await this.blockRepo.findOne({
      where: [
        { user: { id: userId }, targetUser: { id: targetId } },
        { user: { id: targetId }, targetUser: { id: userId } },
      ],
    });
    return !!found;
  }

  async getBlockedUserIds(userId: number): Promise<number[]> {
    const blocks = await this.blockRepo.find({
      where: { user: { id: userId } },
      relations: ['targetUser'],
    });
    return blocks.map((b) => b.targetUser.id);
  }

  private async validateReport(
    reporterId: number,
    reportedId: number,
  ): Promise<boolean> {
    // 1. محدودیت روزانه
    const dailyKey = `report:daily:${reporterId}:${new Date().toISOString().split('T')[0]}`;
    const dailyCount = await this.redis.incr(dailyKey);
    if (dailyCount === 1) {
      await this.redis.expire(dailyKey, 86400);
    }
    if (dailyCount > 5) {
      return false; // بیش از ۵ گزارش در روز
    }

    // 3. اعتماد گزارش‌دهنده
    const reporterTrust =
      await this.trustScoreService.calculateTrustScore(reporterId);
    if (reporterTrust < 40) {
      return false; // کاربر کم‌اعتماد
    }

    return true;
  }

  private async autoBlockUser(userId: number) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return;

    user.status = 'admin_blocked';
    user.blockedAt = new Date();
    user.blockReason = 'auto_block_multiple_reports';

    await this.userRepo.save(user);

    this.logger.warn(`User ${userId} auto-blocked due to multiple reports`);

    await this.userEventService.log({
      userId,
      type: EventType.USER_AUTO_BLOCKED,
      metadata: { reason: 'multiple_reports', autoBlocked: true },
    });
  }

  async getReportsAgainst(userId: number): Promise<Report[]> {
    return this.reportRepo.find({
      where: { reportedUser: { id: userId }, confirmed: true },
    });
  }
}
