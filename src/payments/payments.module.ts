import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';

import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { CreditsModule } from './credits/credits.module';
import { BoostsModule } from './boosts/boosts.module';
import { PhaseModule } from '../phase/phase.module';
import { PaywallModule } from './paywall/paywall.module';
import { VipModule } from './vip/vip.module';
import { WalletModule } from './wallet/wallet.module';
import { UserEventModule } from 'src/user-event/user-event.module';
import { ProductBundle } from 'src/product/entities/product-bundle.entity';
import { Payment } from './entities/payment.entity';
import { UserVip } from './vip/entities/vip.entity';
import { User } from 'src/users/entities/user.entity';


import { PromotionExposureService } from './promotion-exposure.service';
import { PromotionEngineService } from './promotion-engine.service';
import { RedisModule } from 'src/redis/redis.module';
import { UserMetricsModule } from 'src/user-metrics/user-metrics.module';
import { SuggestionModule } from 'src/suggestion/suggestion.module';
import { AiFeedbackModule } from 'src/ai-feedback/ai-feedback.module';
import { FeatureStoreModule } from 'src/feature-store/feature-store.module';
import { SEOModule } from 'src/seo/seo.module';
import { EntitlementService } from './wallet/entitlement/entitlement.service';
import { CardTransferProvider } from './wallet/providers/card-transfer.provider';
import { CryptoProvider } from './wallet/providers/crypto.provider';
import { ManualVerifierService } from './wallet/verification/manual-verifier.service';
import { CryptoWatcherProcessor } from './wallet/verification/crypto-watcher.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductBundle, Payment, User, UserVip]),
    BullModule.registerQueue({ name: 'crypto-watcher' }),
    HttpModule,
    SEOModule,
    PhaseModule,
    CreditsModule,
    BoostsModule,
    PaywallModule,
    VipModule,
    WalletModule,
    UserEventModule,
    RedisModule,
    UserMetricsModule,
    SuggestionModule,
    AiFeedbackModule,
    FeatureStoreModule,
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    EntitlementService,
    CardTransferProvider,
    CryptoProvider,
    ManualVerifierService,
    CryptoWatcherProcessor,
    PromotionExposureService,
    PromotionEngineService,
  ],
  exports: [
    PromotionExposureService,
    PromotionEngineService,
    PaymentsService,
    WalletModule,
  ],
})
export class PaymentsModule {}
