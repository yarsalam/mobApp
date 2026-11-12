import {
  Body,
  Controller,
  Headers,
  BadRequestException,
  Get,
  Logger,
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
import { PromotionExposureService } from './promotion-exposure.service';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly cardTransferProvider: CardTransferProvider,
    private readonly cryptoProvider: CryptoProvider,
    private readonly manualVerifier: ManualVerifierService,
    private readonly walletService: WalletService,
    private readonly promotionExposure: PromotionExposureService,
    @InjectRepository(ProductBundle)
    private readonly bundleRepo: Repository<ProductBundle>,
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
    @Body() body?: { promotionId?: string },
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

    const promotionId = body?.promotionId?.trim();
    if (
      promotionId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(promotionId)
    ) {
      throw new BadRequestException('promotionId must be a valid promotion exposure ID');
    }

    // Validate the optional attribution reference before mutating the wallet.
    await this.walletService.debitOnce(
      userId,
      bundle.price,
      `buy:${bundleCode}`,
      `wallet-checkout:${stableKey}:debit`,
    );

    // grant محصول; promotionId is captured in the durable PURCHASE event.
    await this.paymentsService.grantBundle(userId, bundleCode, {
      amountRials: bundle.price,
      source: 'wallet',
      idempotencyKey: `wallet-checkout:${stableKey}`,
      ...(promotionId ? { promotionId } : {}),
    });

    let promotionAttribution: 'not_supplied' | 'recorded' | 'failed' = 'not_supplied';
    if (promotionId) {
      try {
        await this.promotionExposure.trackConversion(
          userId,
          promotionId,
          stableKey,
          bundleCode,
        );
        promotionAttribution = 'recorded';
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Purchase succeeded but promotion attribution failed: ${message}`);
        promotionAttribution = 'failed';
      }
    }

    return {
      success: true,
      message: 'خرید با موفقیت انجام شد',
      promotionAttribution,
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
