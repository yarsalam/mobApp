import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
  ParseIntPipe,
} from '@nestjs/common';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { ReportBlockService } from './report-block.service';
import { CreateReportDto } from './dto/create-report.dto';

type AuthenticatedRequest = {
  user: {
    id?: number | string;
    sub?: number | string;
  };
};

@Controller('report-block')
@UseGuards(JwtAuthGuard)
export class ReportBlockController {
  constructor(private readonly reportBlockService: ReportBlockService) {}

  private getUserId(req: AuthenticatedRequest): number {
    const id = Number(req.user?.id ?? req.user?.sub);

    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new ForbiddenException('Invalid authenticated user');
    }

    return id;
  }

  @Post('report')
  async report(@Req() req: AuthenticatedRequest, @Body() dto: CreateReportDto) {
    const reporterId = this.getUserId(req);

    // reporterId ارسالی از کلاینت قابل اعتماد نیست.
    const result = await this.reportBlockService.reportUser({
      ...dto,
      reporterId,
    });

    return {
      message: 'Report submitted',
      data: result,
    };
  }

  @Post('block')
  async block(
    @Req() req: AuthenticatedRequest,
    @Body('targetId', ParseIntPipe) targetId: number,
  ) {
    const userId = this.getUserId(req);

    const result = await this.reportBlockService.blockUser(userId, targetId);

    return {
      message: 'User blocked',
      data: result,
    };
  }

  @Post('unblock')
  async unblock(
    @Req() req: AuthenticatedRequest,
    @Body('targetId', ParseIntPipe) targetId: number,
  ) {
    const userId = this.getUserId(req);

    await this.reportBlockService.unblockUser(userId, targetId);

    return { message: 'User unblocked' };
  }

  @Get('blocked')
  async getBlockedUsers(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);

    return {
      data: await this.reportBlockService.getBlockedUserIds(userId),
    };
  }

  // @Get('reports')
  // async getAll() {
  //   const reports = await this.reportBlockService.getReports();
  //   return { data: reports };
  // }

  /*
   * عمداً مسیر GET reports در این کنترلر قرار نگرفته است.
   * فهرست گزارش‌های همه کاربران باید فقط از یک کنترلر مدیریتی
   * با Guard و بررسی نقش مدیر قابل دسترسی باشد.
   */
}
