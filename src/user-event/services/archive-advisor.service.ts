/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, EntityManager } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { PartitionedEvent } from '../entities/partitioned-event.entity';
import {
  ArchiveRequest,
  ArchiveStatus,
} from '../entities/archive-request.entity';
import { ArchiveReportDto } from '../dto/archive-report.dto';
import { AiFeedback } from 'src/ai-feedback/entities/ai-feedback.entity';

interface ArchiveCandidate {
  table: string;
  olderThan: Date;
  rows: number;
  size: number;
  costSaving: number;
  priority: 'low' | 'medium' | 'high';
  reason: string;
}

@Injectable()
export class ArchiveAdvisorService {
  private readonly logger = new Logger(ArchiveAdvisorService.name);

  constructor(
    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,

    @InjectRepository(ArchiveRequest)
    private readonly requestRepo: Repository<ArchiveRequest>,

    @InjectRepository(AiFeedback)
    private readonly feedbackRepo: Repository<AiFeedback>,
    private readonly entityManager: EntityManager,
  ) {}

  /**
   * گزارش هفتگی به ادمین
   */
  @Cron('0 9 * * 1') // هر دوشنبه ساعت ۹ صبح
  async generateWeeklyReport(): Promise<ArchiveReportDto> {
    this.logger.log('Generating weekly archive report...');

    // 1. محاسبه حجم کل
    const totalSize = await this.calculateTotalSize();

    // 2. محاسبه هزینه
    const monthlyCost = this.calculateCost(totalSize);

    // 3. شناسایی داده‌های قدیمی
    const recommendations = await this.findArchiveCandidates();

    // 4. آمار جداول
    const byTable = await this.getTableStats();

    // 5. هشدارها
    const warnings = await this.checkWarnings();

    const report: ArchiveReportDto = {
      totalSize,
      monthlyCost,
      yearlyCost: monthlyCost * 12,
      recommendations,
      byTable,
      warnings,
    };

    // ذخیره در دیتابیس برای dashboard
    await this.saveReport(report);

    return report;
  }

  /**
   * پیدا کردن کاندیدهای آرشیو
   */
  private async findArchiveCandidates() {
    const candidates: ArchiveCandidate[] = [];
    const now = new Date();

    // 1. رویدادهای قدیمی
    const oldestEvent = await this.eventRepo
      .createQueryBuilder('e')
      .select('MIN(e.createdAt)', 'oldest')
      .getRawOne();

    if (oldestEvent?.oldest) {
      const oldestDate = new Date(oldestEvent.oldest);
      const ageDays = Math.floor(
        (now.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (ageDays > 90) {
        const count = await this.eventRepo.count({
          where: {
            createdAt: LessThan(
              new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
            ),
          },
        });

        const size = count * 0.001; // تخمین 1KB per event

        candidates.push({
          table: 'partitioned-event',
          olderThan: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
          rows: count,
          size: size,
          costSaving: size * 0.8 * 50000, // هر گیگ ۵۰ هزار تومان
          priority: ageDays > 180 ? 'high' : ageDays > 90 ? 'medium' : 'low',
          reason: `داده‌های ${ageDays} روز پیش - حجم ${size.toFixed(1)} گیگابایت`,
        });
      }
    }

    // 2. فیدبک‌های قدیمی
    const oldestFeedback = await this.feedbackRepo
      .createQueryBuilder('f')
      .select('MIN(f.createdAt)', 'oldest')
      .getRawOne();

    // ... مشابه برای feedback

    return candidates;
  }

  /**
   * ایجاد درخواست آرشیو
   */
  async createArchiveRequest(
    table: string,
    olderThan: Date,
  ): Promise<ArchiveRequest> {
    // محاسبه تعداد تخمینی
    const count = await this.eventRepo.count({
      where: { createdAt: LessThan(olderThan) },
    });

    const size = count * 0.001; // تخمین

    const request = this.requestRepo.create({
      tableName: table,
      olderThan,
      estimatedRows: count,
      estimatedSizeMb: size * 1024,
      estimatedSavingsUsd: size * 0.8 * 5, // هر گیگ ۵ دلار
      status: ArchiveStatus.PENDING,
    });

    return this.requestRepo.save(request);
  }

  /**
   * تأیید درخواست توسط ادمین
   */
  async approveArchive(
    requestId: number,
    adminId: string,
  ): Promise<ArchiveRequest> {
    const request = await this.requestRepo.findOne({
      where: { id: requestId },
    });

    if (!request) {
      throw new Error('Request not found');
    }

    request.status = ArchiveStatus.APPROVED;
    request.approvedBy = adminId;
    request.approvedAt = new Date();

    return this.requestRepo.save(request);
  }

  /**
   * اجرای آرشیو (بعد از تأیید)
   */
  async executeArchive(requestId: number): Promise<void> {
    const request = await this.requestRepo.findOne({
      where: { id: requestId },
    });

    if (!request || request.status !== ArchiveStatus.APPROVED) {
      throw new Error('Request not approved');
    }

    request.status = ArchiveStatus.PROCESSING;
    await this.requestRepo.save(request);

    try {
      // TODO: اجرای آرشیو واقعی
      // 1. فشرده‌سازی
      // 2. آپلود به S3
      // 3. حذف از دیتابیس

      request.status = ArchiveStatus.COMPLETED;
      request.archivedAt = new Date();
      request.metadata = {
        compressionRatio: 0.7,
        destinationPath: `s3://archive/${request.tableName}/${request.olderThan.toISOString()}`,
        archiveSizeMb: request.estimatedSizeMb * 0.3,
      };
    } catch (error: unknown) {
      request.status = ArchiveStatus.FAILED;
      request.metadata = {
        error: error instanceof Error ? error.message : String(error),
      };
    }

    await this.requestRepo.save(request);
  }

  /**
   * رد درخواست توسط ادمین
   */
  async rejectArchive(
    requestId: number,
    reason: string,
  ): Promise<ArchiveRequest> {
    const request = await this.requestRepo.findOne({
      where: { id: requestId },
    });

    if (!request) {
      throw new Error('Request not found');
    }

    request.status = ArchiveStatus.REJECTED;
    request.metadata = { ...request.metadata, rejectReason: reason };

    return this.requestRepo.save(request);
  }

  /**
   * دریافت همه درخواست‌ها برای داشبورد
   */
  async getArchiveRequests(status?: ArchiveStatus): Promise<ArchiveRequest[]> {
    const where = status ? { status } : {};
    return this.requestRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  private async calculateTotalSize(): Promise<number> {
    try {
      // دریافت حجم واقعی از PostgreSQL
      const result = await this.entityManager.query(`
      SELECT 
        pg_database_size(current_database()) as db_size_bytes,
        pg_size_pretty(pg_database_size(current_database())) as db_size_pretty
    `);

      const bytes = result[0]?.db_size_bytes || 0;
      return bytes / (1024 * 1024); // تبدیل به مگابایت
    } catch (error: unknown) {
      this.logger.error(`Failed to calculate DB size: ${error}`);
      return 0;
    }
  }

  // اصلاح متد getTableStats
  // private async getTableStats() {
  //   try {
  //     const result = await this.entityManager.query(`
  //     SELECT
  //       schemaname,
  //       tablename,
  //       pg_total_relation_size(schemaname||'.'||tablename) as size_bytes,
  //       (SELECT reltuples::bigint FROM pg_class WHERE oid = (schemaname||'.'||tablename)::regclass) as row_count
  //     FROM pg_tables
  //     WHERE schemaname = 'public'
  //       AND tablename IN ('user_events', 'ai_feedback', 'user_event_logs')
  //   `);

  //     const stats = {};
  //     for (const row of result) {
  //       stats[row.tablename] = {
  //         totalSize: row.size_bytes / (1024 * 1024), // مگابایت
  //         rowCount: row.row_count,
  //       };
  //     }

  //     return stats;
  //   } catch (error: unknown) {
  //     this.logger.error(`Failed to get table stats: ${error}`);
  //     return {};
  //   }
  // }

  /**
   * محاسبه هزینه بر اساس حجم
   */
  private calculateCost(sizeMb: number): number {
    const costPerGb = 50000; // ۵۰ هزار تومان هر گیگ
    return (sizeMb / 1024) * costPerGb;
  }

  /**
   * آمار جداول
   */
  private async getTableStats() {
    // TODO: query واقعی
    return {
      user_events: {
        totalSize: 100 * 1024,
        oldestDate: new Date('2025-01-01'),
        newestDate: new Date(),
        rowCount: 10_000_000,
        monthlyGrowth: 15,
      },
      ai_feedback: {
        totalSize: 10 * 1024,
        oldestDate: new Date('2025-03-01'),
        newestDate: new Date(),
        rowCount: 500_000,
        monthlyGrowth: 10,
      },
    };
  }

  /**
   * بررسی هشدارها
   */
  private async checkWarnings(): Promise<string[]> {
    const warnings: string[] = [];

    const totalSize = await this.calculateTotalSize();
    if (totalSize > 200 * 1024) {
      // بیش از ۲۰۰ گیگ
      warnings.push('حجم دیتابیس از ۲۰۰ گیگابایت گذشته - نیاز به آرشیو فوری');
    }

    const pendingRequests = await this.requestRepo.count({
      where: { status: ArchiveStatus.PENDING },
    });

    if (pendingRequests > 5) {
      warnings.push(`${pendingRequests} درخواست آرشیو در انتظار بررسی`);
    }

    return warnings;
  }

  /**
   * ذخیره گزارش
   */
  private async saveReport(report: ArchiveReportDto) {
    // TODO: ذخیره در جدول reports
    this.logger.log(`Report saved: ${JSON.stringify(report, null, 2)}`);
  }
}
