import {
  Body,
  Controller,
  Headers,
  BadRequestException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
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
import { PricingExperimentService, PricingCheckout } from 'src/pricing-experiments/pricing-experiment.service';

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
    private readonly pricingExperiment: PricingExperimentService,
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
    @Body() body?: { pricingQuoteId?: string },
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

    const pricingQuoteId = body?.pricingQuoteId?.trim();
    if (pricingQuoteId && pricingQuoteId.length > 4096) {
      throw new BadRequestException('pricingQuoteId is too long');
    }

    let pricingCheckout: PricingCheckout | undefined;
    if (pricingQuoteId) {
      pricingCheckout = await this.pricingExperiment.prepareCheckout(
        userId,
        bundleCode,
        pricingQuoteId,
        stableKey,
      );
    }
    const payablePriceRials = pricingCheckout?.payablePriceRials ?? bundle.price;

    try {
      await this.walletService.debitOnce(
        userId,
        payablePriceRials,
        `buy:${bundleCode}`,
        `wallet-checkout:${stableKey}:debit`,
      );
    } catch (error: unknown) {
      if (pricingCheckout && this.isInsufficientBalance(error)) {
        await this.pricingExperiment.releaseCheckoutReservation(
          userId,
          pricingCheckout.experimentId,
          stableKey,
        );
      }
      throw error;
    }

    // Once the wallet debit succeeds, the lower amount has been charged and
    // the discount budget is consumed even if entitlement fulfillment needs a
    // retry. Commit before grantBundle so a later retry cannot free this spend.
    if (pricingCheckout) {
      await this.pricingExperiment.commitCheckoutReservation(
        userId,
        pricingCheckout,
        stableKey,
      );
    }

    await this.paymentsService.grantBundle(userId, bundleCode, {
      amountRials: payablePriceRials,
      source: 'wallet',
      idempotencyKey: `wallet-checkout:${stableKey}`,
      ...(pricingCheckout ? { pricingExperiment: pricingCheckout } : {}),
    });

    return {
      success: true,
      message: 'خرید با موفقیت انجام شد',
      ...(pricingCheckout
        ? {
            pricingExperiment: {
              experimentId: pricingCheckout.experimentId,
              variant: pricingCheckout.variant,
              discountRials:
                pricingCheckout.basePriceRials - pricingCheckout.payablePriceRials,
            },
          }
        : {}),
    };
  }

  private isInsufficientBalance(error: unknown): boolean {
    const candidate = error as {
      code?: string;
      response?: { code?: string };
      getResponse?: () => unknown;
    };
    if (candidate?.code === 'INSUFFICIENT_BALANCE') return true;
    if (candidate?.response?.code === 'INSUFFICIENT_BALANCE') return true;
    if (typeof candidate?.getResponse === 'function') {
      const response = candidate.getResponse();
      return (
        typeof response === 'object' &&
        response !== null &&
        'code' in response &&
        (response as { code?: unknown }).code === 'INSUFFICIENT_BALANCE'
      );
    }
    return false;
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
