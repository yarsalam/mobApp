import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Report,
  ReportStatus,
} from '../../../report-block/entities/report.entity';
import { Block } from '../../../report-block/entities/block.entity';
import { User } from '../../../users/entities/user.entity';

@Controller('admin-api/safety/reports')
@UseGuards(AdminApiGuard)
export class SafetyReportsController {
  constructor(
    @InjectRepository(Report) private reportRepo: Repository<Report>,
    @InjectRepository(Block) private blockRepo: Repository<Block>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  @Get()
  async getAll(@Query('status') status?: string) {
    const where: any = {};
    if (status) where.status = status;
    return this.reportRepo.find({
      where,
      relations: ['reporter', 'reportedUser'],
    });
  }

  @Post(':id/confirm')
  async confirm(@Param('id') id: number) {
    await this.reportRepo.update(id, { status: ReportStatus.CONFIRMED });
    return { success: true };
  }

  @Post(':id/reject')
  async reject(@Param('id') id: number) {
    await this.reportRepo.update(id, { status: ReportStatus.REJECTED });
    return { success: true };
  }

  @Post(':id/block')
  async blockUser(
    @Param('id') reportId: number,
    @Body('adminId') adminId: string,
  ) {
    // بارگذاری گزارش همراه با کاربر گزارش‌شده
    const report = await this.reportRepo.findOne({
      where: { id: reportId },
      relations: ['reportedUser'],
    });
    if (!report) throw new NotFoundException('Report not found');

    // ایجاد بلاک با ارجاع به Userها از طریق id
    const block = this.blockRepo.create({
      user: { id: +adminId } as User, // تبدیل به عدد و cast
      targetUser: { id: report.reportedUser.id } as User,
    });
    await this.blockRepo.save(block);

    // به‌روزرسانی وضعیت گزارش
    await this.reportRepo.update(reportId, {
      status: ReportStatus.ACTIONTAKEN,
    });

    return { success: true };
  }

  @Post('unblock/:userId')
  async unblockUser(@Param('userId') userId: number) {
    await this.blockRepo.delete({ targetUser: { id: userId } });
    return { success: true };
  }
}
