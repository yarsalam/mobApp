import {
  Body,
  Controller,
  Headers,
  Inject,
  BadRequestException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentsService } from './payments.service';
import { AdminApiGuard } from 'src/admin-api/guards/api-key.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../current-user/current-user.decorator';
import { WalletService } from './wallet/wallet.service';
import { CardTransferProvider } from './wallet/providers/card-transfer.provider';
import { CryptoProvider } from './wallet/providers/crypto.provider';
import { ManualVerifierService } from './wallet/verification/manual-verifier.service';
import { ProductBundle } from 'src/product/entities/product-bundle.entity';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { ManualPromotionService } from 'src/manual-promotions/manual-promotion.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly cardTransferProvider: CardTransferProvider,
    private readonly cryptoProvider: CryptoProvider,
    private readonly manualVerifier: ManualVerifierService,
    private readonly walletService: WalletService,
    @InjectRepository(ProductBundle)
    private readonly bundleRepo: Repository<ProductBundle>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() private readonly manualPromotionService?: ManualPromotionService,
  ) {}

  // ─── کاربر: دریافت موجودی wallet ────────────────────────────

  @Get('wallet')
  @UseGuards(JwtAuthGuard)
  async getWallet(@CurrentUser('sub') userId: number) {
    const wallet = await this.walletService.get(userId);
    const balance = Number(wallet.balance);
    return {
      success: true,
      data: {
        balance, // ریال خام
        balanceDisplay: (balance / 10).toLocaleString('fa-IR'), // تومان
        currency: 'IRT',
      },
    };
  }

  // ─── کاربر: شارژ wallet از طریق کارت ────────────────────────

  @Post('deposit/card')
  @UseGuards(JwtAuthGuard)
  async depositByCard(
    @CurrentUser('sub') userId: number,
    @Body() body: { amountRials: number },
  ) {
    // productCode برای deposit = 'wallet_charge'
    const result = await this.cardTransferProvider.initiate(
      userId,
      'wallet_charge',
      body.amountRials,
    );
    return { success: true, data: result };
  }

  // ─── کاربر: شارژ wallet از طریق کریپتو ──────────────────────

  @Post('deposit/crypto')
  @UseGuards(JwtAuthGuard)
  async depositByCrypto(
    @CurrentUser('sub') userId: number,
    @Body() body: { amountRials: number },
  ) {
    // تبدیل ریال به سنت USDT برای crypto provider
    const amountCents = Math.ceil(body.amountRials / (900 * 10)); // تقریبی
    const result = await this.cryptoProvider.initiate(
      userId,
      'wallet_charge',
      amountCents,
    );
    return { success: true, data: result };
  }

  // ─── کاربر: خرید محصول از wallet ────────────────────────────

  @Post('buy/:bundleCode')
  @UseGuards(JwtAuthGuard)
  async buyWithWallet(
    @CurrentUser('sub') userId: number,
    @Param('bundleCode') bundleCode: string,
    @Body() body?: { promotionId?: string; manualPromotionId?: string },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const stableKey = idempotencyKey?.trim();
    if (!stableKey || stableKey.length > 80) {
      throw new BadRequestException(
        'Idempotency-Key header is required and must be at most 80 characters',
      );
    }

    const bundle = await this.bundleRepo.findOne({
      where: { code: bundleCode, active: true },
    });
    if (!bundle) throw new NotFoundException('محصول یافت نشد');

    // Automatic promotion IDs are attribution-only. A manual campaign ID is
    // a separate, server-validated discount authorization and must match the
    // campaign bound to the displayed promotion.
    const suppliedPromotionId = body?.promotionId;
    if (body?.manualPromotionId !== undefined &&
        typeof body.manualPromotionId !== 'string') {
      throw new NotFoundException('Promotion not found');
    }
    const manualPromotionId = body?.manualPromotionId?.trim();
    if (manualPromotionId && !suppliedPromotionId) {
      throw new NotFoundException('Promotion not found');
    }
    if (
      suppliedPromotionId !== undefined &&
      (typeof suppliedPromotionId !== 'string' ||
        suppliedPromotionId.trim().length === 0)
    ) {
      throw new NotFoundException('Promotion not found');
    }
    const promotionId =
      typeof suppliedPromotionId === 'string'
        ? suppliedPromotionId.trim()
        : undefined;
    let promotionAttribution:
      | { promotionId: string; variant: string; phase?: string }
      | undefined;
    if (promotionId) {
      if (promotionId.length < 16 || promotionId.length > 128) {
        throw new NotFoundException('Promotion not found');
      }
      const promotionRaw = await this.redis.get(`promo:map:${promotionId}`);
      if (!promotionRaw) throw new NotFoundException('Promotion not found');

      let promotionMap: {
        userId?: unknown;
        variant?: unknown;
        phase?: unknown;
        campaignId?: unknown;
      };
      try {
        promotionMap = JSON.parse(promotionRaw) as typeof promotionMap;
      } catch {
        throw new NotFoundException('Promotion not found');
      }
      if (
        Number(promotionMap.userId) !== userId ||
        typeof promotionMap.variant !== 'string' ||
        !/^[a-z][a-z0-9_-]{0,31}$/i.test(promotionMap.variant)
      ) {
        throw new NotFoundException('Promotion not found');
      }
      if (
        (manualPromotionId &&
          (promotionMap.variant !== 'manual_discount' ||
            promotionMap.campaignId !== manualPromotionId)) ||
        (!manualPromotionId && typeof promotionMap.campaignId === 'string')
      ) {
        throw new NotFoundException('Promotion not found');
      }
      promotionAttribution = {
        promotionId,
        variant: promotionMap.variant,
        ...(typeof promotionMap.phase === 'string'
          ? { phase: promotionMap.phase }
          : {}),
        ...(typeof promotionMap.campaignId === 'string'
          ? { campaignId: promotionMap.campaignId }
          : {}),
      };
    }

    let manualRedemption:
      | {
          campaignId: string;
          redemptionId: string;
          bundleCode: string;
          basePriceRials: number;
          discountRials: number;
          payablePriceRials: number;
        }
      | undefined;

    if (manualPromotionId) {
      if (!this.manualPromotionService) {
        throw new NotFoundException('Promotion not found');
      }
      manualRedemption = await this.manualPromotionService.reserveForCheckout(
        userId,
        manualPromotionId,
        bundleCode,
        stableKey,
      );
    }
    const payablePriceRials =
      manualRedemption?.payablePriceRials ?? bundle.price;

    // The wallet receipt and balance debit remain atomic. A definitive
    // insufficient-balance result releases only this reservation; ambiguous
    // failures retain it so the same idempotency key can safely resume.
    try {
      await this.walletService.debitOnce(
        userId,
        payablePriceRials,
        `buy:${bundleCode}`,
        `wallet-checkout:${stableKey}:debit`,
      );
    } catch (error: unknown) {
      if (manualRedemption && this.isInsufficientBalance(error)) {
        await this.manualPromotionService!.releaseReservation(
          manualRedemption.campaignId,
          manualRedemption.redemptionId,
          userId,
        );
      }
      throw error;
    }

    if (manualRedemption) {
      await this.manualPromotionService!.markRedeemed(
        manualRedemption.campaignId,
        manualRedemption.redemptionId,
        userId,
      );
    }

    // grant محصول
    await this.paymentsService.grantBundle(userId, bundleCode, {
      amountRials: payablePriceRials,
      source: 'wallet',
      idempotencyKey: `wallet-checkout:${stableKey}`,
      ...(promotionAttribution ? { promotionAttribution } : {}),
      ...(manualRedemption
        ? {
            manualPromotion: {
              campaignId: manualRedemption.campaignId,
              redemptionId: manualRedemption.redemptionId,
              basePriceRials: manualRedemption.basePriceRials,
              discountRials: manualRedemption.discountRials,
              payablePriceRials: manualRedemption.payablePriceRials,
            },
          }
        : {}),
    });

    return {
      success: true,
      message: 'خرید با موفقیت انجام شد',
      ...(manualRedemption
        ? {
            manualPromotion: {
              campaignId: manualRedemption.campaignId,
              discountRials: manualRedemption.discountRials,
              payablePriceRials: manualRedemption.payablePriceRials,
            },
          }
        : {}),
    };
  }

  // ─── کاربر: آپلود رسید ───────────────────────────────────────

  @Post(':paymentId/proof')
  @UseGuards(JwtAuthGuard)
  async submitProof(
    @CurrentUser('sub') userId: number,
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Body() body: { proofUrl: string },
  ) {
    await this.cardTransferProvider.submitProof(paymentId, userId, body.proofUrl);
    return {
      success: true,
      message: 'رسید دریافت شد، منتظر تأیید ادمین باشید',
    };
  }

  // ─── ادمین ───────────────────────────────────────────────────

  @Post('admin/confirm/:paymentId')
  @UseGuards(AdminApiGuard)
  async adminConfirm(
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Body() body: { note?: string },
  ) {
    await this.manualVerifier.confirm(paymentId, body.note);
    return { success: true };
  }

  @Post('admin/reject/:paymentId')
  @UseGuards(AdminApiGuard)
  async adminReject(
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Body() body: { reason: string },
  ) {
    await this.manualVerifier.reject(paymentId, body.reason);
    return { success: true };
  }

  @Post('grant-bundle/:userId/:bundleCode')
  @UseGuards(AdminApiGuard)
  async grantBundle(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('bundleCode') bundleCode: string,
  ) {
    await this.paymentsService.grantBundle(userId, bundleCode);
    return { success: true, userId, bundleCode };
  }
}
