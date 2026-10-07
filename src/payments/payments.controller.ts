import {
  Body,
  Controller,
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
  ) {
    const bundle = await this.bundleRepo.findOne({
      where: { code: bundleCode, active: true },
    });
    if (!bundle) throw new NotFoundException('محصول یافت نشد');

    // کسر از wallet به ریال
    await this.walletService.debit(userId, bundle.price, `buy:${bundleCode}`);

    // grant محصول
    await this.paymentsService.grantBundle(userId, bundleCode);

    return { success: true, message: 'خرید با موفقیت انجام شد' };
  }

  // ─── کاربر: آپلود رسید ───────────────────────────────────────

  @Post(':paymentId/proof')
  @UseGuards(JwtAuthGuard)
  async submitProof(
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Body() body: { proofUrl: string },
  ) {
    await this.cardTransferProvider.submitProof(paymentId, body.proofUrl);
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
