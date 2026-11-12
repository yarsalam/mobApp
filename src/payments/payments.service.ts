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
import { createHash } from 'crypto';
import { User } from 'src/users/entities/user.entity';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(ProductBundle)
    private readonly bundleRepo: Repository<ProductBundle>,

    @InjectRepository(UserVip)
    private readonly vipRepo: Repository<UserVip>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly creditsService: CreditsService,
    private readonly boostService: BoostService,
    private readonly phaseService: PhaseService,
    private readonly userEventService: UserEventService,
    private readonly featureStore: FeatureStoreService,
    private readonly configService: ConfigService,
    private readonly vipService: VipService,
  ) {}

  async grantBundle(
    userId: number,
    bundleCode: string,
    purchaseContext?: {
      amountRials: number;
      source: 'wallet' | 'payment';
      idempotencyKey?: string;
      promotionId?: string;
    },
  ) {
    try {
      const bundle = await this.bundleRepo.findOne({
        where: { code: bundleCode, active: true },
      });

      if (!bundle) throw new Error('Bundle not found');

      // Capture a minimized, normalized gender snapshot at the purchase
      // boundary. Reports must not reclassify a historical purchase when a
      // user later edits their profile.
      const buyer = await this.userRepo.findOne({
        where: { id: userId },
        select: ['id', 'gender'],
      });
      const rawGender = String(buyer?.gender ?? '').trim().toLocaleLowerCase();
      const genderAtPurchase: 'male' | 'female' | 'unknown' =
        ['male', 'man', 'm', 'مرد', 'آقا', 'اقا'].includes(rawGender)
          ? 'male'
          : ['female', 'woman', 'f', 'زن', 'خانم'].includes(rawGender)
            ? 'female'
            : 'unknown';

      const idempotencyKey = purchaseContext?.idempotencyKey;
      let itemIndex = 0;
      for (const item of bundle.items) {
        const itemKey = idempotencyKey
          ? `fulfill:${createHash('sha256').update(`${idempotencyKey}:item:${itemIndex}`).digest('hex').slice(0, 48)}`
          : undefined;

        if (item.type === 'credits') {
          if (itemKey) await this.creditsService.grantOnce(userId, item.amount, itemKey);
          else await this.creditsService.grant(userId, item.amount);
        }

        if (item.type === 'boost') {
          if (itemKey) await this.boostService.grantInstantOnce(userId, item.amount, itemKey, bundleCode);
          else await this.boostService.grantInstant(userId, item.amount);
        }

        if (item.type === 'vip') {
          if (itemKey) await this.vipService.activateVipOnce(userId, item.durationDays || 30, itemKey, bundleCode);
          else await this.vipService.activateVip(userId, item.durationDays || 30);
        }
        itemIndex += 1;
      }

      const purchaseEventKey = idempotencyKey
        ? `purchase:${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 56)}`
        : undefined;
      await this.userEventService.log({
        userId,
        type: EventType.PURCHASE,
        metadata: {
          bundleCode,
          genderAtPurchase,
          isCommercialPurchase: Boolean(purchaseContext),
          ...(purchaseContext
            ? {
                amountRials: purchaseContext.amountRials,
                currency: 'IRT',
                source: purchaseContext.source,
                ...(purchaseContext.promotionId
                  ? { promotionId: purchaseContext.promotionId }
                  : {}),
              }
            : { source: 'admin_or_system_grant' }),
        },
        idempotencyKey: purchaseEventKey,
      });

      try {
        await this.phaseService.markEverPaid(userId);
        await this.phaseService.learnFromFeedback(userId, 'purchase', {
          amount: bundle.price,
          productType: bundleCode,
        });
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
