import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhaseModule } from '../phase/phase.module';
import { ProductBundle } from '../product/entities/product-bundle.entity';
import { User } from '../users/entities/user.entity';
import { ManualPromotionCampaign } from './entities/manual-promotion-campaign.entity';
import { ManualPromotionRedemption } from './entities/manual-promotion-redemption.entity';
import { ManualPromotionQuoteController } from './manual-promotion-quote.controller';
import { ManualPromotionService } from './manual-promotion.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ManualPromotionCampaign,
      ManualPromotionRedemption,
      ProductBundle,
      User,
    ]),
    PhaseModule,
  ],
  controllers: [ManualPromotionQuoteController],
  providers: [ManualPromotionService],
  exports: [ManualPromotionService],
})
export class ManualPromotionsModule {}
