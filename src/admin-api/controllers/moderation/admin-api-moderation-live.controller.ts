import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { ModerationService } from '../../../moderation/moderation.service';

@Controller('admin-api/moderation-live')
@UseGuards(AdminApiGuard)
export class AdminApiModerationLiveController {
  constructor(private readonly moderationService: ModerationService) {}

  /**
   * بررسی دستی یک متن دلخواه توسط ادمین — مثلاً برای تست این‌که آیا یک الگوی خاص
   * (کلمه، عبارت مشکوک) توسط موتور moderation فعلی درست تشخیص داده می‌شود یا نه.
   * برخلاف /moderation/check که برای پیام واقعی بین دو کاربر است، این صرفاً یک ابزار تست ادمین است.
   */
  @Post('test')
  async testModeration(
    @Body() body: { text: string; senderId?: number; receiverId?: number },
  ) {
    const result = await this.moderationService.moderateMessage(
      body.text,
      body.senderId ?? 0,
      body.receiverId ?? 0,
    );
    return { success: true, data: result };
  }

  /**
   * پروفایل ریسک یک کاربر خاص — برای نمایش در تب Safety صفحه‌ی User360.
   */
  @Get('user/:userId/risk')
  async getUserRisk(@Param('userId') userId: number) {
    const risk = await this.moderationService.getUserRiskProfile(userId);
    return { success: true, data: risk };
  }

  /**
   * رفع محدودیت ارسال پیام یک کاربر که به‌اشتباه یا موقتاً محدود شده.
   */
  @Post('user/:userId/unblock')
  async unblockUser(@Param('userId') userId: number) {
    await this.moderationService.unblockUser(userId);
    return { success: true, message: 'محدودیت کاربر رفع شد' };
  }

  /**
   * لیست کاربران پرخطر برای صف بررسی دستی تیم Trust & Safety.
   */
  @Get('high-risk-users')
  async getHighRiskUsers() {
    const users = await this.moderationService.getHighRiskUsers(20, 'high');
    return { success: true, data: users };
  }
}
