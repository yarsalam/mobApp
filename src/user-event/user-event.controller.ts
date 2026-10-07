import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ArchiveAdvisorService } from './services/archive-advisor.service';
// import { AdminGuard } from '../auth/admin.guard';
import { ArchiveStatus } from './entities/archive-request.entity';

@Controller('admin/archive')
// @UseGuards(AdminGuard)
export class ArchiveController {
  constructor(private readonly advisor: ArchiveAdvisorService) {}

  /**
   * دریافت گزارش هفتگی
   */
  @Get('report')
  async getReport() {
    return this.advisor.generateWeeklyReport();
  }

  /**
   * دریافت لیست درخواست‌ها
   */
  @Get('requests')
  async getRequests(@Query('status') status?: ArchiveStatus) {
    return this.advisor.getArchiveRequests(status);
  }

  /**
   * ایجاد درخواست آرشیو جدید
   */
  @Post('request')
  async createRequest(@Body() body: { table: string; olderThan: Date }) {
    return this.advisor.createArchiveRequest(body.table, body.olderThan);
  }

  /**
   * تأیید درخواست
   */
  @Post('request/:id/approve')
  async approveRequest(
    @Param('id') id: string,
    @Body('adminId') adminId: string,
  ) {
    return this.advisor.approveArchive(+id, adminId);
  }

  /**
   * رد درخواست
   */
  @Post('request/:id/reject')
  async rejectRequest(@Param('id') id: string, @Body('reason') reason: string) {
    return this.advisor.rejectArchive(+id, reason);
  }

  /**
   * اجرای آرشیو (بعد از تأیید)
   */
  @Post('request/:id/execute')
  async executeArchive(@Param('id') id: string) {
    await this.advisor.executeArchive(+id);
    return { message: 'آرشیو با موفقیت انجام شد' };
  }

  /**
   * داشبورد آرشیو
   */
  @Get('dashboard')
  async getDashboard() {
    const [report, requests] = await Promise.all([
      this.advisor.generateWeeklyReport(),
      this.advisor.getArchiveRequests(),
    ]);

    return {
      summary: {
        totalSize: report.totalSize,
        monthlyCost: report.monthlyCost,
        potentialSavings: report.recommendations.reduce(
          (sum, r) => sum + r.costSaving,
          0,
        ),
      },
      recommendations: report.recommendations,
      pendingRequests: requests.filter(
        (r) => r.status === ArchiveStatus.PENDING,
      ).length,
      warnings: report.warnings,
    };
  }
}
