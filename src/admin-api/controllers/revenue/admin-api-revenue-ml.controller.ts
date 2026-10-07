import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { RevenueAttributionService } from '../../../revenue/revenue-attribution.service';

@Controller('admin-api/revenue-ml')
@UseGuards(AdminApiGuard)
export class AdminApiRevenueMlController {
  constructor(private readonly revenueAttribution: RevenueAttributionService) {}

  /**
   * پیش‌بینی LTV یک کاربر خاص از طریق مدل ai_revenue.
   * اگر سرویس ML در دسترس نباشد، RevenueAttributionService خودش
   * fallback میانگین‌گیری از کاربران مشابه (همان شهر/جنسیت) را اجرا می‌کند.
   */
  @Get('/predicted-ltv/:userId')
  async getPredictedLTV(@Param('userId', ParseIntPipe) userId: number) {
    const predictedLtv = await this.revenueAttribution.predictLTV(userId);
    return { success: true, data: { userId, predictedLtv } };
  }
}
