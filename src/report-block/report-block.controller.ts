import { Body, Controller, Get, Post } from '@nestjs/common';
import { ReportBlockService } from './report-block.service';
import { CreateReportDto } from './dto/create-report.dto';

@Controller('report-block')
export class ReportBlockController {
  constructor(private readonly reportBlockService: ReportBlockService) {}

  @Post('report')
  async report(@Body() dto: CreateReportDto) {
    const result = await this.reportBlockService.reportUser(dto);
    return { message: 'Report submitted', data: result };
  }

  @Post('block')
  async block(@Body() body: { userId: number; targetId: number }) {
    const result = await this.reportBlockService.blockUser(
      body.userId,
      body.targetId,
    );
    return { message: 'User blocked', data: result };
  }

  @Get('reports')
  async getAll() {
    const reports = await this.reportBlockService.getReports();
    return { data: reports };
  }

  @Post('unblock')
  async unblock(@Body() body: { userId: number; targetId: number }) {
    await this.reportBlockService.unblockUser(body.userId, body.targetId);
    return { message: 'User unblocked' };
  }
}
