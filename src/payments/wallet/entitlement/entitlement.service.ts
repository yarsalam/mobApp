import { Injectable, Logger } from '@nestjs/common';
import { Payment } from 'src/payments/entities/payment.entity';
import { PaymentsService } from 'src/payments/payments.service';
import { WalletService } from '../wallet.service';
/**
 * EntitlementService — لایه بین Payment و grantBundle.
 *
 * وظیفه: از productCode payment، تشخیص بده چه چیزی grant شود.
 * این لایه امکان می‌دهد در آینده productCode → bundle mapping را
 * از DB بخوانیم بدون اینکه PaymentsService تغییر کند.
 */
@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  async grantFromPayment(payment: Payment, amountRials?: number): Promise<void> {
    if (payment.productCode === 'wallet_charge') {
      // Wallet top-ups are credited by the payment verifier, not granted as a bundle.
      return;
    }

    const normalizedAmountRials =
      amountRials ?? (payment.currency === 'IRT'
        ? Number(payment.amount)
        : payment.currency === 'USDT'
          ? WalletService.usdtCentsToRials(Number(payment.amount))
          : null);

    if (!Number.isSafeInteger(normalizedAmountRials) || Number(normalizedAmountRials) <= 0) {
      throw new Error(
        `Cannot grant paid bundle ${payment.productCode}: payment currency/unit is not safely convertible to IRT rials`,
      );
    }

    try {
      await this.paymentsService.grantBundle(
        payment.userId,
        payment.productCode,
        {
          amountRials: Number(normalizedAmountRials),
          source: 'payment',
          idempotencyKey: `payment:${payment.id}:bundle`,
        },
      );
      this.logger.log(
        `Entitlement granted: user=${payment.userId} bundle=${payment.productCode}`,
      );
    } catch (err) {
      this.logger.error(
        `Entitlement grant failed: paymentId=${payment.id} bundle=${payment.productCode} error=${err.message}`,
      );
      // TODO: در اینجا می‌توانی alert به ادمین بفرستی
      // چون payment تأیید شده ولی grant ناموفق بود — باید retry شود
      throw err;
    }
  }
}
