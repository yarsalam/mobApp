import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Inject } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import Redis from 'ioredis';
import { Repository } from 'typeorm';

import { ProductBundle } from '../product/entities/product-bundle.entity';
import { User } from '../users/entities/user.entity';
import { PartitionedEvent } from '../user-event/entities/partitioned-event.entity';
import { EventType } from '../user-event/type/event-type.enum';
import { UserEventService } from '../user-event/user-event.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

type PricingVariant = 'control' | 'treatment';

interface PricingExperimentConfig {
  experimentId: string;
  secret: string;
  discountBps: number;
  treatmentRateBps: number;
}

interface PricingQuotePayload {
  v: 1;
  userId: number;
  bundleCode: string;
  experimentId: string;
  assignmentId: string;
  variant: PricingVariant;
  basePriceRials: number;
  payablePriceRials: number;
  discountBps: number;
  issuedAt: number;
  expiresAt: number;
}

export interface PricingCheckout {
  experimentId: string;
  assignmentId: string;
  variant: PricingVariant;
  basePriceRials: number;
  payablePriceRials: number;
  discountBps: number;
  currency: 'IRT';
}

@Injectable()
export class PricingExperimentService {
  private readonly quoteTtlMs = 24 * 60 * 60 * 1000;
  private readonly reservationTtlSeconds = 365 * 24 * 60 * 60;

  constructor(
    @InjectRepository(ProductBundle)
    private readonly bundles: Repository<ProductBundle>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(PartitionedEvent)
    private readonly events: Repository<PartitionedEvent>,
    private readonly userEvents: UserEventService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private experimentConfig(): PricingExperimentConfig | null {
    if (this.config.get<string>('PRICING_EXPERIMENT_ENABLED') !== 'true') {
      return null;
    }

    const experimentId = this.config.get<string>('PRICING_EXPERIMENT_ID')?.trim() ?? '';
    const secret = this.config.get<string>('PRICING_EXPERIMENT_SECRET') ?? '';
    const discountBps = Number(this.config.get<string>('PRICING_EXPERIMENT_DISCOUNT_BPS'));
    const treatmentRateBps = Number(
      this.config.get<string>('PRICING_EXPERIMENT_TREATMENT_RATE_BPS'),
    );

    if (
      !/^[A-Za-z0-9._:-]{1,96}$/.test(experimentId) ||
      secret.length < 32 ||
      !Number.isInteger(discountBps) ||
      discountBps < 1 ||
      discountBps > 3000 ||
      !Number.isInteger(treatmentRateBps) ||
      treatmentRateBps < 1 ||
      treatmentRateBps > 9999
    ) {
      throw new ServiceUnavailableException(
        'Pricing experiment is enabled but its configuration is incomplete or outside safe bounds',
      );
    }

    return { experimentId, secret, discountBps, treatmentRateBps };
  }

  private mac(secret: string, value: string): Buffer {
    return createHmac('sha256', secret).update(value).digest();
  }

  private assignment(config: PricingExperimentConfig, userId: number): {
    assignmentId: string;
    variant: PricingVariant;
  } {
    const assignmentDigest = this.mac(
      config.secret,
      `${config.experimentId}:assignment:${userId}`,
    );
    const bucket = assignmentDigest.readUInt32BE(0) % 10_000;
    const assignmentId =
      'px_' +
      this.mac(config.secret, `${config.experimentId}:id:${userId}`)
        .toString('hex')
        .slice(0, 40);

    return {
      assignmentId,
      variant: bucket < config.treatmentRateBps ? 'treatment' : 'control',
    };
  }

  private async isFirstPurchaseEligible(userId: number): Promise<boolean> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'status'],
    });
    if (!user || user.status !== 'active') return false;

    const previousCommercialPurchases = await this.events
      .createQueryBuilder('event')
      .where('event.userId = :userId', { userId })
      .andWhere('event.type = :purchaseType', {
        purchaseType: EventType.PURCHASE,
      })
      .andWhere(
        "JSON_UNQUOTE(JSON_EXTRACT(event.metadata, '$.isCommercialPurchase')) = 'true'",
      )
      .getCount();

    return previousCommercialPurchases === 0;
  }

  private sign(payload: PricingQuotePayload, secret: string): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.mac(secret, encoded).toString('base64url');
    return `${encoded}.${signature}`;
  }

  private verifySignature(quoteId: string, secret: string): PricingQuotePayload {
    if (typeof quoteId !== 'string' || quoteId.length > 4096) {
      throw new BadRequestException('Invalid pricing quote');
    }

    const parts = quoteId.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new BadRequestException('Invalid pricing quote');
    }

    const expected = this.mac(secret, parts[0]);
    let supplied: Buffer;
    try {
      supplied = Buffer.from(parts[1], 'base64url');
    } catch {
      throw new BadRequestException('Invalid pricing quote signature');
    }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new BadRequestException('Invalid pricing quote signature');
    }

    try {
      const payload = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8'),
      ) as PricingQuotePayload;
      if (!payload || payload.v !== 1) {
        throw new Error('Unsupported quote version');
      }
      return payload;
    } catch {
      throw new BadRequestException('Invalid pricing quote payload');
    }
  }

  private exposureKey(assignmentId: string, bundleCode: string): string {
    const digest = createHash('sha256')
      .update(`${assignmentId}:${bundleCode}`)
      .digest('hex')
      .slice(0, 56);
    return `pricing-exposure:${digest}`;
  }

  private exposureMetadata(quote: PricingQuotePayload): Record<string, unknown> {
    return {
      promotionKind: 'pricing_experiment',
      experimentId: quote.experimentId,
      assignmentId: quote.assignmentId,
      variant: quote.variant,
      bundleCode: quote.bundleCode,
      currency: 'IRT',
      basePriceRials: quote.basePriceRials,
      payablePriceRials: quote.payablePriceRials,
      discountRials: quote.basePriceRials - quote.payablePriceRials,
      discountBps: quote.discountBps,
      quoteExpiresAt: new Date(quote.expiresAt).toISOString(),
    };
  }

  async getQuote(userId: number, bundleCode: string) {
    const bundle = await this.bundles.findOne({
      where: { code: bundleCode, active: true },
    });
    if (!bundle) throw new BadRequestException('محصول فعال یافت نشد');
    if (!Number.isSafeInteger(bundle.price) || bundle.price <= 0) {
      throw new ServiceUnavailableException('Bundle price is not a valid IRT amount');
    }

    const base = {
      bundleCode,
      currency: 'IRT' as const,
      basePriceRials: bundle.price,
      payablePriceRials: bundle.price,
      discountRials: 0,
      discountBps: 0,
      variant: null as PricingVariant | null,
      experimentId: null as string | null,
      quoteId: null as string | null,
      eligibleForExperiment: false,
    };

    const config = this.experimentConfig();
    if (!config || !(await this.isFirstPurchaseEligible(userId))) {
      return base;
    }

    const assignment = this.assignment(config, userId);
    const discountBps =
      assignment.variant === 'treatment' ? config.discountBps : 0;
    const payablePriceRials = Math.floor(
      (bundle.price * (10_000 - discountBps)) / 10_000,
    );
    if (
      !Number.isSafeInteger(payablePriceRials) ||
      payablePriceRials <= 0 ||
      payablePriceRials > bundle.price
    ) {
      throw new ServiceUnavailableException('Calculated pricing quote is invalid');
    }

    const issuedAt = Date.now();
    const payload: PricingQuotePayload = {
      v: 1,
      userId,
      bundleCode,
      experimentId: config.experimentId,
      assignmentId: assignment.assignmentId,
      variant: assignment.variant,
      basePriceRials: bundle.price,
      payablePriceRials,
      discountBps,
      issuedAt,
      expiresAt: issuedAt + this.quoteTtlMs,
    };

    return {
      ...base,
      payablePriceRials,
      discountRials: bundle.price - payablePriceRials,
      discountBps,
      variant: assignment.variant,
      experimentId: config.experimentId,
      quoteId: this.sign(payload, config.secret),
      eligibleForExperiment: true,
      expiresAt: new Date(payload.expiresAt).toISOString(),
    };
  }

  private async verifyQuote(
    userId: number,
    quoteId: string,
    requireExposure: boolean,
  ): Promise<PricingQuotePayload> {
    const config = this.experimentConfig();
    if (!config) {
      throw new ConflictException('Pricing experiment is not active');
    }

    const quote = this.verifySignature(quoteId, config.secret);
    const now = Date.now();
    if (
      quote.userId !== userId ||
      typeof quote.bundleCode !== 'string' ||
      quote.experimentId !== config.experimentId ||
      !Number.isSafeInteger(quote.issuedAt) ||
      !Number.isSafeInteger(quote.expiresAt) ||
      quote.issuedAt > now + 30_000 ||
      quote.expiresAt <= now ||
      quote.expiresAt - quote.issuedAt !== this.quoteTtlMs
    ) {
      throw new ConflictException('Pricing quote is expired or does not belong to this checkout');
    }

    const assignment = this.assignment(config, userId);
    const expectedDiscountBps =
      assignment.variant === 'treatment' ? config.discountBps : 0;
    const expectedPayable = Math.floor(
      (quote.basePriceRials * (10_000 - expectedDiscountBps)) / 10_000,
    );
    if (
      quote.assignmentId !== assignment.assignmentId ||
      quote.variant !== assignment.variant ||
      quote.discountBps !== expectedDiscountBps ||
      quote.payablePriceRials !== expectedPayable ||
      !Number.isSafeInteger(quote.basePriceRials) ||
      quote.basePriceRials <= 0
    ) {
      throw new ConflictException('Pricing quote no longer matches the active experiment');
    }

    const bundle = await this.bundles.findOne({
      where: { code: quote.bundleCode, active: true },
    });
    if (!bundle || bundle.price !== quote.basePriceRials) {
      throw new ConflictException('Product price changed; request a new quote');
    }

    if (!(await this.isFirstPurchaseEligible(userId))) {
      throw new ConflictException('First-purchase pricing is no longer available');
    }

    if (requireExposure) {
      const exposure = await this.events.findOne({
        where: {
          userId,
          type: EventType.PROMOTION_SHOWN,
          idempotencyKey: this.exposureKey(quote.assignmentId, quote.bundleCode),
        },
      });
      const metadata = exposure?.metadata ?? {};
      if (
        !exposure ||
        metadata.promotionKind !== 'pricing_experiment' ||
        metadata.experimentId !== quote.experimentId ||
        metadata.assignmentId !== quote.assignmentId ||
        metadata.variant !== quote.variant ||
        Number(metadata.payablePriceRials) !== quote.payablePriceRials
      ) {
        throw new ConflictException('Pricing quote must be exposed before checkout');
      }
    }

    return quote;
  }

  async recordExposure(userId: number, quoteId: string) {
    const quote = await this.verifyQuote(userId, quoteId, false);
    await this.userEvents.log({
      userId,
      type: EventType.PROMOTION_SHOWN,
      metadata: this.exposureMetadata(quote),
      idempotencyKey: this.exposureKey(quote.assignmentId, quote.bundleCode),
    });
    return {
      success: true,
      experimentId: quote.experimentId,
      variant: quote.variant,
    };
  }

  async prepareCheckout(
    userId: number,
    bundleCode: string,
    quoteId: string,
    idempotencyKey: string,
  ): Promise<PricingCheckout> {
    const quote = await this.verifyQuote(userId, quoteId, true);
    if (quote.bundleCode !== bundleCode) {
      throw new ConflictException('Pricing quote belongs to a different product');
    }

    if (quote.variant === 'treatment') {
      const reservationKey = `pricing:redeemed:${quote.experimentId}:${userId}`;
      const result = await this.redis.set(
        reservationKey,
        idempotencyKey,
        'EX',
        this.reservationTtlSeconds,
        'NX',
      );
      if (result !== 'OK') {
        const existing = await this.redis.get(reservationKey);
        if (existing !== idempotencyKey) {
          throw new ConflictException('First-purchase offer is already reserved by another checkout');
        }
      }
    }

    return {
      experimentId: quote.experimentId,
      assignmentId: quote.assignmentId,
      variant: quote.variant,
      basePriceRials: quote.basePriceRials,
      payablePriceRials: quote.payablePriceRials,
      discountBps: quote.discountBps,
      currency: 'IRT',
    };
  }

  async releaseTreatmentReservation(
    userId: number,
    experimentId: string,
    idempotencyKey: string,
  ): Promise<void> {
    const key = `pricing:redeemed:${experimentId}:${userId}`;
    const script =
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
    await this.redis.eval(script, 1, key, idempotencyKey);
  }

  async getExperimentReport(experimentId: string, days = 90) {
    if (!/^[A-Za-z0-9._:-]{1,96}$/.test(experimentId)) {
      throw new BadRequestException('experimentId is invalid');
    }
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new BadRequestException('days must be an integer between 1 and 3650');
    }

    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.events
      .createQueryBuilder('exposure')
      .leftJoin(
        PartitionedEvent,
        'purchase',
        `purchase.userId = exposure.userId
          AND purchase.type = :purchaseType
          AND JSON_UNQUOTE(JSON_EXTRACT(purchase.metadata, '$.pricingExperiment.experimentId')) = :experimentId
          AND JSON_UNQUOTE(JSON_EXTRACT(purchase.metadata, '$.pricingExperiment.assignmentId')) = JSON_UNQUOTE(JSON_EXTRACT(exposure.metadata, '$.assignmentId'))
          AND purchase.createdAt >= exposure.createdAt`,
        {
          purchaseType: EventType.PURCHASE,
          experimentId,
        },
      )
      .select("JSON_UNQUOTE(JSON_EXTRACT(exposure.metadata, '$.variant'))", 'variant')
      .addSelect('COUNT(DISTINCT exposure.userId)', 'exposedUsers')
      .addSelect('COUNT(DISTINCT purchase.userId)', 'purchasedUsers')
      .addSelect(
        "COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(purchase.metadata, '$.pricingExperiment.basePriceRials')) AS DECIMAL(20,0)) - CAST(JSON_UNQUOTE(JSON_EXTRACT(purchase.metadata, '$.amountRials')) AS DECIMAL(20,0))), 0)",
        'discountRials',
      )
      .addSelect(
        "COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(purchase.metadata, '$.amountRials')) AS DECIMAL(20,0))), 0)",
        'revenueRials',
      )
      .where('exposure.type = :exposureType', {
        exposureType: EventType.PROMOTION_SHOWN,
      })
      .andWhere("JSON_UNQUOTE(JSON_EXTRACT(exposure.metadata, '$.promotionKind')) = 'pricing_experiment'")
      .andWhere("JSON_UNQUOTE(JSON_EXTRACT(exposure.metadata, '$.experimentId')) = :experimentId", {
        experimentId,
      })
      .andWhere('exposure.createdAt >= :since', { since })
      .groupBy("JSON_UNQUOTE(JSON_EXTRACT(exposure.metadata, '$.variant'))")
      .getRawMany();

    const byVariant = new Map<string, any>(rows.map((row) => [row.variant, row]));
    const variants = (['control', 'treatment'] as const).map((variant) => {
      const row = byVariant.get(variant);
      const exposedUsers = Number(row?.exposedUsers ?? 0);
      const purchasedUsers = Number(row?.purchasedUsers ?? 0);
      const revenueRials = Number(row?.revenueRials ?? 0);
      const discountRials = Number(row?.discountRials ?? 0);
      const safeNumber = (value: number) =>
        Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;

      return {
        variant,
        exposedUsers: safeNumber(exposedUsers),
        purchasedUsers: safeNumber(purchasedUsers),
        conversionRatePercent:
          exposedUsers > 0
            ? Math.round((purchasedUsers / exposedUsers) * 10_000) / 100
            : null,
        revenueRials: safeNumber(revenueRials),
        discountRials: safeNumber(discountRials),
      };
    });

    return {
      experimentId,
      currency: 'IRT',
      unit: 'rial',
      periodDays: days,
      variants,
      interpretation:
        'descriptive_only; conversion differences are not causal or statistically significant without adequate sample size, duration and pre-registered analysis',
    };
  }
}
