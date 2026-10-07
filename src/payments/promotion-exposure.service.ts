import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { AiFeedbackService } from 'src/ai-feedback/ai-feedback.service';
import { REDIS_CLIENT } from 'src/redis/redis.constants';
import { PaywallService } from './paywall/paywall.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout } from 'rxjs';
import { FeatureService } from '../user-metrics/feature.service';

@Injectable()
export class PromotionExposureService {
  private readonly logger = new Logger(PromotionExposureService.name);
  private readonly mlUrl: string;

  private readonly DAILY_LIMITS: Record<string, number> = {
    boost: 3,
    vip: 2,
    credit: 4,
    credits: 4,
    profile: 1,
    bundle: 2,
  };

  private readonly COOLDOWN_HOURS: Record<string, number> = {
    boost: 6,
    vip: 12,
    credit: 4,
    credits: 4,
    profile: 24,
    bundle: 48,
  };

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly aiFeedbackService: AiFeedbackService,
    private readonly paywallService: PaywallService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly featureService: FeatureService,
  ) {
    this.mlUrl = this.configService.get(
      'AI_MONETIZATION_URL',
      'http://ai_monetization:8015',
    );
  }

  async canShow(userId: number, variant: string): Promise<boolean> {
    try {
      const dailyKey = `promo:daily:${userId}:${variant}:${this.getTodayDate()}`;
      const dailyCount = await this.redis.get(dailyKey);
      const dailyLimit = this.DAILY_LIMITS[variant] ?? 2;
      if (dailyCount && parseInt(dailyCount) >= dailyLimit) return false;

      const lastShownKey = `promo:last:${userId}:${variant}`;
      const lastShown = await this.redis.get(lastShownKey);
      if (lastShown) {
        const hoursSinceLastShow =
          (Date.now() - parseInt(lastShown)) / (1000 * 60 * 60);
        const cooldown = this.COOLDOWN_HOURS[variant] ?? 6;
        if (hoursSinceLastShow < cooldown) return false;
      }

      const blockKey = `promo:block:${userId}:${variant}`;
      const blocked = await this.redis.get(blockKey);
      return !blocked;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in canShow: ${message}`);
      return true;
    }
  }

  async trackImpression(userId: number, variant: string) {
    try {
      const today = this.getTodayDate();
      const dailyKey = `promo:daily:${userId}:${variant}:${today}`;
      await this.redis.incr(dailyKey);
      await this.redis.expire(dailyKey, 86400);
      const lastShownKey = `promo:last:${userId}:${variant}`;
      await this.redis.set(lastShownKey, Date.now().toString(), 'EX', 86400);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in trackImpression: ${message}`);
    }
  }

  async trackDismiss(userId: number, variant: string, promotionId: string) {
    try {
      const dismissKey = `promo:dismiss:${userId}:${variant}`;
      const count = await this.redis.get(dismissKey);
      const newCount = count ? parseInt(count) + 1 : 1;
      await this.redis.set(dismissKey, newCount.toString(), 'EX', 604800);

      if (newCount >= 3) {
        const blockKey = `promo:block:${userId}:${variant}`;
        await this.redis.set(blockKey, '1', 'EX', 86400);
      }

      const promoMap = await this.redis.get(`promo:map:${promotionId}`);
      const phase = promoMap ? JSON.parse(promoMap).phase || 'warm' : 'warm';
      const product = variant;
      const tone = promoMap
        ? JSON.parse(promoMap).tone || 'soft_sell'
        : 'soft_sell';

      if (['boost', 'credit', 'credits', 'vip', 'bundle'].includes(product)) {
        await this.paywallService.adjustWeights(phase, product, tone, -0.5);
      }

      await this.aiFeedbackService.create({
        userId,
        feature: 'promotion',
        feedbackType: 'dismiss',
        value: { variant, promotionId },
        convertedToPurchase: false,
      });

      const features = await this.featureService.getUserFeatures(userId);
      await firstValueFrom(
        this.httpService
          .post(`${this.mlUrl}/api/feedback`, {
            user_id: userId,
            variant,
            features,
            label: 0,
          })
          .pipe(timeout(3000)),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in trackDismiss: ${message}`);
      return true;
    }
  }

  private getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}
