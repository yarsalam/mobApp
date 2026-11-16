import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../current-user/current-user.decorator';
import { ManualPromotionService } from './manual-promotion.service';

@Controller('promotions/manual')
@UseGuards(JwtAuthGuard)
export class ManualPromotionQuoteController {
  constructor(private readonly promotions: ManualPromotionService) {}

  @Get(':campaignId/quote/:bundleCode')
  quote(
    @CurrentUser('sub') userId: number,
    @Param('campaignId') campaignId: string,
    @Param('bundleCode') bundleCode: string,
  ) {
    return this.promotions.getQuote(userId, campaignId, bundleCode);
  }
}
