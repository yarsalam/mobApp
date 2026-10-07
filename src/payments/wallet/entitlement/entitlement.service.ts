import { Injectable, Logger } from '@nestjs/common';
import { Payment } from 'src/payments/entities/payment.entity';
import { PaymentsService } from 'src/payments/payments.service';
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

  async grantFromPayment(payment: Payment): Promise<void> {
    try {
      await this.paymentsService.grantBundle(
        payment.userId,
        payment.productCode,
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
