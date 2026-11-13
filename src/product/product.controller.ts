import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductBundle } from './entities/product-bundle.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../current-user/current-user.decorator';
import { PricingExperimentService } from '../pricing-experiments/pricing-experiment.service';

/**
 * ProductController
 *
 * محصولات را از DB می‌خواند — نه هاردکد.
 * ادمین می‌تواند از پنل ادمین bundle بسازد/ویرایش کند.
 */
@Controller('product')
export class ProductController {
  constructor(
    @InjectRepository(ProductBundle)
    private readonly bundleRepo: Repository<ProductBundle>,
    private readonly pricingExperiment: PricingExperimentService,
  ) {}

  @Get('quote/:bundleCode')
  @UseGuards(JwtAuthGuard)
  async getPricingQuote(
    @CurrentUser('sub') userId: number,
    @Param('bundleCode') bundleCode: string,
  ) {
    return this.pricingExperiment.getQuote(userId, bundleCode);
  }

  @Post('pricing-exposure')
  @UseGuards(JwtAuthGuard)
  async recordPricingExposure(
    @CurrentUser('sub') userId: number,
    @Body() body: { quoteId?: string },
  ) {
    if (!body?.quoteId) {
      throw new BadRequestException('quoteId is required');
    }
    return this.pricingExperiment.recordExposure(userId, body.quoteId);
  }

  /**
   * لیست محصولات فعال — گروه‌بندی شده بر اساس نوع اول item
   * فرانت از این endpoint محصولات را می‌خواند
   */
  @Get('public')
  async getPublicProducts() {
    const bundles = await this.bundleRepo.find({
      where: { active: true },
      order: { price: 'ASC' },
    });

    const boost: any[] = [];
    const credits: any[] = [];
    const vip: any[] = [];

    for (const bundle of bundles) {
      const primaryItem = bundle.items[0];
      if (!primaryItem) continue;

      const option = {
        id: bundle.code,
        label: this.generateLabel(bundle),
        price: bundle.price, // ریال
        priceToman: bundle.price / 10, // تومان برای نمایش
        meta: this.generateMeta(bundle),
      };

      if (primaryItem.type === 'boost') boost.push(option);
      else if (primaryItem.type === 'credits') credits.push(option);
      else if (primaryItem.type === 'vip') vip.push(option);
    }

    return { boost, credits, vip };
  }

  private generateLabel(bundle: ProductBundle): string {
    const item = bundle.items[0];
    if (!item) return bundle.code;

    if (item.type === 'boost') return `${item.amount} بوست`;
    if (item.type === 'credits') return `${item.amount} اعتبار`;
    if (item.type === 'vip') return `VIP روزه${item.durationDays}`;
    return bundle.code;
  }

  private generateMeta(bundle: ProductBundle): Record<string, any> {
    const meta: Record<string, any> = {};
    for (const item of bundle.items) {
      if (item.type === 'boost') meta.boostCount = item.amount;
      if (item.type === 'credits') meta.creditsAmount = item.amount;
      if (item.type === 'vip') meta.vipDays = item.durationDays;
    }
    return meta;
  }
}
