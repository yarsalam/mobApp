import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import { AiFeedbackService } from 'src/ai-feedback/ai-feedback.service';
import { REDIS_CLIENT } from 'src/redis/redis.constants';
import { PaywallService } from './paywall/paywall.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout } from 'rxjs';
import { Cron } from '@nestjs/schedule';
import { FeatureService } from '../user-metrics/feature.service';
import { UserEventService } from 'src/user-event/user-event.service';
import { EventType } from 'src/user-event/type/event-type.enum';

interface PromotionContext {
  userId: number;
  variant: string;
  score?: number;
  phase?: string;
  tone?: string;
  experimentId?: string;
  assignmentId?: string;
  propensity?: number;
  features?: Record<string, number>;
  scoreKind?: string;
  modelStatus?: string;
  position?: number;
  impressionAt?: number;
}

@Injectable()
export class PromotionExposureService {
  private readonly logger = new Logger(PromotionExposureService.name);
  private readonly mlUrl: string;
  private readonly ATTRIBUTION_TTL_SECONDS = 7 * 24 * 60 * 60;
  private readonly EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;

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
    private readonly userEventService: UserEventService,
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
      if (dailyCount && Number.parseInt(dailyCount, 10) >= dailyLimit) return false;

      const lastShownKey = `promo:last:${userId}:${variant}`;
      const lastShown = await this.redis.get(lastShownKey);
      if (lastShown) {
        const hoursSinceLastShow =
          (Date.now() - Number.parseInt(lastShown, 10)) / (1000 * 60 * 60);
        const cooldown = this.COOLDOWN_HOURS[variant] ?? 6;
        if (hoursSinceLastShow < cooldown) return false;
      }

      const blockKey = `promo:block:${userId}:${variant}`;
      return !(await this.redis.get(blockKey));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in canShow: ${message}`);
      // Fail closed: do not exceed frequency limits when Redis is unavailable.
      return false;
    }
  }

  private async getPromotionContext(
    userId: number,
    promotionId: string,
  ): Promise<PromotionContext> {
    if (!promotionId || promotionId.length > 80) {
      throw new NotFoundException('Promotion not found');
    }
    const raw = await this.redis.get(`promo:map:${promotionId}`);
    if (!raw) throw new NotFoundException('Promotion not found or attribution expired');

    let context: PromotionContext;
    try {
      context = JSON.parse(raw) as PromotionContext;
    } catch {
      throw new NotFoundException('Promotion metadata is invalid');
    }
    if (!context || Number(context.userId) !== Number(userId) || !context.variant) {
      throw new NotFoundException('Promotion does not belong to this user');
    }
    return context;
  }

  async trackImpression(
    userId: number,
    promotionId: string,
  ): Promise<{ success: true; duplicate: boolean }> {
    const context = await this.getPromotionContext(userId, promotionId);
    const variant = context.variant;

    // The mobile client calls this only when the promotion becomes visible.
    // Building a feed is not itself counted as an impression.
    await this.userEventService.log({
      userId,
      type: EventType.PROMOTION_SHOWN,
      metadata: {
        promotionId,
        variant,
        score: context.score,
        position: context.position,
        experimentId: context.experimentId,
        assignmentId: context.assignmentId,
        propensity: context.propensity,
        scoreKind: context.scoreKind,
        modelStatus: context.modelStatus,
      },
      idempotencyKey: `promotion:${promotionId}:shown`,
    });

    const firstSeen = await this.redis.set(
      `promo:event:${promotionId}:shown`,
      '1',
      'EX',
      this.EVENT_TTL_SECONDS,
      'NX',
    );
    if (!firstSeen) return { success: true, duplicate: true };

    context.impressionAt = Date.now();
    await this.redis.set(
      `promo:map:${promotionId}`,
      JSON.stringify(context),
      'EX',
      8 * 24 * 60 * 60,
    );

    const today = this.getTodayDate();
    const dailyKey = `promo:daily:${userId}:${variant}:${today}`;
    await this.redis.incr(dailyKey);
    await this.redis.expire(dailyKey, 86400);
    await this.redis.set(
      `promo:last:${userId}:${variant}`,
      Date.now().toString(),
      'EX',
      86400,
    );
    await this.redis.zadd(
      'promo:pending-outcomes',
      Date.now() + 7 * 24 * 60 * 60 * 1000,
      promotionId,
    );
    return { success: true, duplicate: false };
  }

  async trackClick(
    userId: number,
    promotionId: string,
  ): Promise<{ success: true; duplicate: boolean }> {
    const context = await this.getPromotionContext(userId, promotionId);
    if (!(await this.redis.exists(`promo:event:${promotionId}:shown`))) {
      throw new NotFoundException('Promotion impression has not been recorded');
    }
    await this.userEventService.log({
      userId,
      type: EventType.PROMOTION_CLICKED,
      metadata: { promotionId, variant: context.variant },
      idempotencyKey: `promotion:${promotionId}:click`,
    });

    const firstClick = await this.redis.set(
      `promo:event:${promotionId}:click`,
      '1',
      'EX',
      this.EVENT_TTL_SECONDS,
      'NX',
    );
    if (firstClick) {
      await this.sendFeedback(userId, promotionId, context, 'click');
    }
    return { success: true, duplicate: !firstClick };
  }

  async trackDismiss(
    userId: number,
    promotionId: string,
  ): Promise<{ success: true; duplicate: boolean }> {
    const context = await this.getPromotionContext(userId, promotionId);
    const { variant } = context;
    if (!(await this.redis.exists(`promo:event:${promotionId}:shown`))) {
      throw new NotFoundException('Promotion impression has not been recorded');
    }

    await this.userEventService.log({
      userId,
      type: EventType.PROMOTION_DISMISSED,
      metadata: { promotionId, variant },
      idempotencyKey: `promotion:${promotionId}:dismiss`,
    });

    const firstDismiss = await this.redis.set(
      `promo:event:${promotionId}:dismiss`,
      '1',
      'EX',
      this.EVENT_TTL_SECONDS,
      'NX',
    );
    if (!firstDismiss) return { success: true, duplicate: true };

    const dismissKey = `promo:dismiss:${userId}:${variant}`;
    const newCount = await this.redis.incr(dismissKey);
    await this.redis.expire(dismissKey, 604800);

    if (newCount >= 3) {
      await this.redis.set(`promo:block:${userId}:${variant}`, '1', 'EX', 86400);
    }

    if (['boost', 'credit', 'credits', 'vip', 'bundle'].includes(variant)) {
      try {
        await this.paywallService.adjustWeights(
          context.phase || 'warm',
          variant,
          context.tone || 'soft_sell',
          -0.5,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Paywall adjustment after dismiss failed: ${message}`);
      }
    }

    try {
      await this.aiFeedbackService.create({
        userId,
        feature: 'promotion',
        feedbackType: 'dismiss',
        value: { variant, promotionId },
        convertedToPurchase: false,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI feedback persistence after dismiss failed: ${message}`);
    }

    await this.sendFeedback(userId, promotionId, context, 'dismiss');
    return { success: true, duplicate: false };
  }

  async trackConversion(
    userId: number,
    promotionId: string,
    purchaseReference: string,
    productCode: string,
  ): Promise<{ success: true; duplicate: boolean }> {
    const context = await this.getPromotionContext(userId, promotionId);
    if (!(await this.redis.exists(`promo:event:${promotionId}:shown`))) {
      throw new NotFoundException('Promotion impression has not been recorded');
    }
    const impressionAt = Number(context.impressionAt ?? 0);
    if (
      !Number.isFinite(impressionAt) ||
      impressionAt <= 0 ||
      Date.now() > impressionAt + this.ATTRIBUTION_TTL_SECONDS * 1000
    ) {
      throw new NotFoundException('Promotion attribution window has expired');
    }

    const purchaseHash = createHash('sha256')
      .update(`${userId}:${String(purchaseReference)}`)
      .digest('hex')
      .slice(0, 32);

    // A single purchase idempotency key must never be attributed to two
    // different promotion exposures, even if a retry changes its request body.
    const purchaseAttributionKey =
      `promo:purchase-attribution:${userId}:${purchaseHash}`;
    const reservedForThisPromotion = await this.redis.set(
      purchaseAttributionKey,
      promotionId,
      'EX',
      this.ATTRIBUTION_TTL_SECONDS,
      'NX',
    );
    if (!reservedForThisPromotion) {
      const existingPromotionId = await this.redis.get(purchaseAttributionKey);
      if (existingPromotionId !== promotionId) {
        throw new ConflictException(
          'This purchase is already attributed to a different promotion',
        );
      }
    }

    // Persist the durable database event before setting the per-exposure
    // Redis dedupe marker. UserEventService.log is itself idempotent.
    await this.userEventService.log({
      userId,
      type: EventType.PROMOTION_CONVERTED,
      metadata: {
        promotionId,
        variant: context.variant,
        productCode,
        purchaseReference: purchaseHash,
      },
      idempotencyKey: `promotion:${promotionId}:conversion`,
    });

    const firstConversion = await this.redis.set(
      `promo:event:${promotionId}:converted`,
      '1',
      'EX',
      this.EVENT_TTL_SECONDS,
      'NX',
    );
    if (!firstConversion) return { success: true, duplicate: true };

    if (firstConversion) {
      await this.redis.set(
        `promo:conversion:${promotionId}`,
        JSON.stringify({ productCode, purchaseHash }),
        'EX',
        this.ATTRIBUTION_TTL_SECONDS,
      );
      await this.redis.zrem('promo:pending-outcomes', promotionId);
      const delivered = await this.sendFeedback(
        userId,
        promotionId,
        context,
        'conversion',
        1,
        { product_code: productCode, purchase_reference: purchaseHash },
      );
      if (!delivered) {
        // Retry delivery from the scheduled outcome worker; the conversion
        // marker prevents it from ever being mislabeled as a non-conversion.
        await this.redis.zadd('promo:pending-outcomes', Date.now(), promotionId);
      }
    }
    return { success: true, duplicate: !firstConversion };
  }

  private async sendFeedback(
    userId: number,
    promotionId: string,
    context: PromotionContext,
    eventType: 'click' | 'dismiss' | 'conversion' | 'non_conversion',
    label?: number,
    extraContext: Record<string, unknown> = {},
  ): Promise<boolean> {
    try {
      const features = context.features ?? await this.featureService.getUserFeatures(userId);
      const body: Record<string, unknown> = {
        user_id: userId,
        variant: context.variant,
        features,
        promotion_id: promotionId,
        feedback_id: `promotion:${promotionId}:${eventType}${extraContext.purchase_reference ? ':' + extraContext.purchase_reference : ''}`,
        event_type: eventType,
        experiment_id: context.experimentId,
        assignment_id: context.assignmentId,
        propensity: context.propensity,
        outcome_window_complete: extraContext.outcome_window_complete === true,
        context: extraContext,
      };
      if (label !== undefined) body.label = label;
      await firstValueFrom(
        this.httpService.post(`${this.mlUrl}/api/feedback`, body).pipe(timeout(3000)),
      );
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Monetization feedback delivery failed: ${message}`);
      return false;
    }
  }

  @Cron('15 * * * *')
  async processMaturePromotionOutcomes(): Promise<void> {
    const now = Date.now();
    const due = await this.redis.zrangebyscore(
      'promo:pending-outcomes',
      '-inf',
      now,
      'LIMIT',
      0,
      100,
    );

    for (const promotionId of due) {
      try {
        const raw = await this.redis.get(`promo:map:${promotionId}`);
        if (!raw) {
          await this.redis.zrem('promo:pending-outcomes', promotionId);
          continue;
        }
        const context = JSON.parse(raw) as PromotionContext;
        const userId = Number(context.userId);
        if (!Number.isSafeInteger(userId) || userId <= 0) {
          await this.redis.zrem('promo:pending-outcomes', promotionId);
          continue;
        }

        const conversionRaw = await this.redis.get(`promo:conversion:${promotionId}`);
        if (conversionRaw) {
          const conversion = JSON.parse(conversionRaw) as {
            productCode: string;
            purchaseHash: string;
          };
          const delivered = await this.sendFeedback(
            userId,
            promotionId,
            context,
            'conversion',
            1,
            {
              product_code: conversion.productCode,
              purchase_reference: conversion.purchaseHash,
            },
          );
          if (delivered) await this.redis.zrem('promo:pending-outcomes', promotionId);
          continue;
        }

        await this.userEventService.log({
          userId,
          type: EventType.PROMOTION_NON_CONVERTED,
          metadata: { promotionId, variant: context.variant, attributionWindowDays: 7 },
          idempotencyKey: `promotion:${promotionId}:non-conversion`,
        });
        const delivered = await this.sendFeedback(
          userId,
          promotionId,
          context,
          'non_conversion',
          0,
          { outcome_window_complete: true, attribution_window_days: 7 },
        );
        if (delivered) await this.redis.zrem('promo:pending-outcomes', promotionId);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Could not mature promotion outcome ${promotionId}: ${message}`);
      }
    }
  }

  private getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}
