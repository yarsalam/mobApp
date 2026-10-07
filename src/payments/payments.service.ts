import { Injectable, Logger } from '@nestjs/common';
import { CreditsService } from './credits/credits.service';
import { BoostService } from './boosts/boosts.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PhaseService } from '../phase/phase.service';
import { UserEventService } from 'src/user-event/user-event.service';
import { ProductBundle } from 'src/product/entities/product-bundle.entity';
import { FeatureStoreService } from 'src/feature-store/feature-store.service';
import { ConfigService } from '@nestjs/config';
import { VipService } from './vip/vip.service';
import { UserVip } from './vip/entities/vip.entity';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(ProductBundle)
    private readonly bundleRepo: Repository<ProductBundle>,

    @InjectRepository(UserVip)
    private readonly vipRepo: Repository<UserVip>,

    private readonly creditsService: CreditsService,
    private readonly boostService: BoostService,
    private readonly phaseService: PhaseService,
    private readonly userEventService: UserEventService,
    private readonly featureStore: FeatureStoreService,
    private readonly configService: ConfigService,
    private readonly vipService: VipService,
  ) {}

  async grantBundle(userId: number, bundleCode: string) {
    try {
      const bundle = await this.bundleRepo.findOne({
        where: { code: bundleCode, active: true },
      });

      if (!bundle) throw new Error('Bundle not found');

      for (const item of bundle.items) {
        if (item.type === 'credits') {
          await this.creditsService.grant(userId, item.amount);
        }

        if (item.type === 'boost') {
          await this.boostService.grantInstant(userId, item.amount);
        }

        if (item.type === 'vip') {
          await this.vipService.activateVip(userId, item.durationDays || 30);
        }
      }

      await this.userEventService.log({
        userId,
        type: EventType.PURCHASE,
        metadata: { bundleCode },
      });

      try {
        await this.phaseService.markEverPaid(userId);
        await this.phaseService.learnFromFeedback(userId, 'purchase', {
          amount: bundle.price,
          productType: bundleCode,
        });
        await this.featureStore.learnFeatureWeights(userId, 'purchase');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`یادگیری خرید ناموفق بود: ${msg}`);
      }

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`grantBundle failed: ${message}`);
      throw error;
    }
  }

  /**
   * رفع باگ: بررسی واقعی اشتراک فعال کاربر از UserVip
   */
  async hasActiveSubscription(userId: number, type: string): Promise<boolean> {
    if (type === 'vip' || type === 'assistant') {
      return this.vipService.hasVip(userId);
    }
    // برای سایر انواع در آینده قابل گسترش است
    return false;
  }
}
