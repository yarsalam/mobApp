import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { GetUser } from 'src/auth/decorator/get-user/get-user.decorator';
import { FeedAssemblerService } from './services/feed-assembler.service';
import { FeedPromotionService } from './services/feed-promotion.service';

@ApiTags('feed')
@Controller('feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(
    private readonly feedAssembler: FeedAssemblerService,
    private readonly feedPromotionService: FeedPromotionService,
  ) {}

  @Post('dismiss/:promotionId')
  @ApiOperation({ summary: 'ثبت بستن تبلیغ' })
  async dismissPromotion(
    @GetUser('id') userId: number,
    @Param('promotionId') promotionId: string,
  ) {
    return this.feedPromotionService.dismissPromotion(userId, promotionId);
  }

  @Post('click/:promotionId')
  @ApiOperation({ summary: 'ثبت کلیک روی پروموشن' })
  async clickPromotion(
    @GetUser('id') userId: number,
    @Param('promotionId') promotionId: string,
  ) {
    return this.feedPromotionService.trackPromotionClick(userId, promotionId);
  }

  @Get()
  @ApiOperation({ summary: 'دریافت فید شخصی‌سازی شده' })
  async getFeed(
    @GetUser('id') userId: number,
    @Query('limit') limit?: number,
    @Query('city') city?: string,
  ) {
    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(Math.floor(parsedLimit), 50))
      : 20;

    const feed = await this.feedAssembler.buildFeed(userId, {
      limit: safeLimit,
      city,
    });
    return { success: true, data: feed, timestamp: new Date().toISOString() };
  }
}
