import { Module } from '@nestjs/common';
import { PaywallService } from './paywall.service';
import { PaywallDecisionService } from './paywall-decision.service';
import { PhaseModule } from '../../phase/phase.module';
import { DevicePhoneModule } from 'src/auth/device-phone/device-phone.module';
import { VipModule } from '../vip/vip.module';
import { CreditsModule } from '../credits/credits.module';
import { TrustModule } from 'src/trust/trust.module';
import { RevenueModule } from 'src/revenue/revenue.module';

/**
 * PaywallModule
 *
 * جمع‌آوری تمام ماژول‌هایی که PaywallDecisionService به آن‌ها نیاز دارد:
 *   - PhaseModule      → engagement score (cold/warm/hot)
 *   - TrustModule      → trustScore + deviceRisk
 *   - RevenueModule    → predictedLTV
 *   - CreditsModule    → balance + consume
 *   - VipModule        → hasVip
 *
 * هیچ منطق محاسباتی در این لایه نیست — هر سرویس مالک داده خودش است.
 */
@Module({
  imports: [
    PhaseModule,
    DevicePhoneModule,
    VipModule,
    CreditsModule,
    TrustModule,
    RevenueModule,
  ],
  providers: [PaywallService, PaywallDecisionService],
  exports: [PaywallService, PaywallDecisionService],
})
export class PaywallModule {}