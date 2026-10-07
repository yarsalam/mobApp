import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  ParseIntPipe,
  Query,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ModerationService } from './moderation.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../current-user/current-user.decorator';

@ApiTags('moderation')
@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Post('check')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'بررسی یک متن قبل از ارسال' })
  @ApiResponse({ status: 200, description: 'نتیجه بررسی برگردانده شد' })
  async checkMessage(
    @CurrentUser('sub') userId: number,
    @Body() body: { text: string; receiverId: number },
    @Req() req: any,
  ) {
    const result = await this.moderationService.moderateMessage(
      body.text,
      userId,
      body.receiverId,
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );

    return {
      success: true,
      data: {
        allowed: result.action === 'allow',
        severity: result.severity,
        ...(process.env.NODE_ENV === 'development' && {
          flags: result.flags,
          confidence: result.confidence,
        }),
      },
    };
  }

  @Post('check-async')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'بررسی در پس‌زمینه (برای پیام‌های قدیمی)' })
  async checkMessageAsync(
    @CurrentUser('sub') userId: number,
    @Body() body: { text: string; receiverId: number; messageId?: number },
  ) {
    await this.moderationService.moderateMessageAsync(
      body.text,
      userId,
      body.receiverId,
      body.messageId,
    );
    return { success: true, message: 'بررسی در صف قرار گرفت' };
  }

  @Get('user/:userId/risk')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'دریافت ریسک کاربر' })
  async getUserRisk(@Param('userId', ParseIntPipe) userId: number) {
    const risk = await this.moderationService.getUserRiskProfile(userId);
    return { success: true, data: risk };
  }

  @Get('stats/daily')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'آمار روزانه' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  async getDailyStats(@Query('days') days: number = 7) {
    const stats = await this.moderationService.getDailyStats(days);
    return { success: true, data: stats };
  }

  @Get('high-risk-users')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'لیست کاربران پرخطر' })
  async getHighRiskUsers(
    @Query('limit') limit: number = 20,
    @Query('minSeverity') minSeverity: string = 'high',
  ) {
    const users = await this.moderationService.getHighRiskUsers(
      limit,
      minSeverity,
    );
    return { success: true, data: users };
  }

  @Post('user/:userId/unblock')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'رفع محدودیت کاربر' })
  async unblockUser(@Param('userId', ParseIntPipe) userId: number) {
    await this.moderationService.unblockUser(userId);
    return { success: true, message: 'محدودیت کاربر رفع شد' };
  }

  @Get('reports/export')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'خروجی اکسل گزارش‌ها' })
  async exportReports(@Query('start') start: Date, @Query('end') end: Date) {
    const csv = await this.moderationService.exportReportsToCsv(
      new Date(start),
      new Date(end),
    );
    return { success: true, data: csv };
  }

  @Get('health')
  async healthCheck() {
    const health = await this.moderationService.healthCheck();
    return { success: true, data: health };
  }
}
