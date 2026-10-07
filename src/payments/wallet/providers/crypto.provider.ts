import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Payment } from 'src/payments/entities/payment.entity';
import { EventType } from 'src/user-event/type/event-type.enum';
import { UserEventService } from 'src/user-event/user-event.service';
import { Repository } from 'typeorm';

export interface CryptoInitResult {
  paymentId: number;
  walletAddress: string;
  network: string;
  amount: number; // سنت (500 = 5.00 USDT)
  currency: 'USDT';
  expiresAt: Date;
}

@Injectable()
export class CryptoProvider {
  private readonly logger = new Logger(CryptoProvider.name);

  /**
   * آدرس wallet یارسلام برای دریافت — از env.
   * در نسخه‌های بعدی: هر payment آدرس اختصاصی می‌گیرد (HD wallet).
   */
  private readonly WALLET_ADDRESS_TRC20 = process.env.CRYPTO_WALLET_TRC20 || '';

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly userEventService: UserEventService,
  ) {}

  async initiate(
    userId: number,
    productCode: string,
    amountCents: number, // 500 = 5 USDT
  ): Promise<CryptoInitResult> {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 ساعت

    const payment = this.paymentRepo.create({
      userId,
      productCode,
      amount: amountCents,
      currency: 'USDT',
      method: 'crypto_usdt',
      status: 'pending',
      walletAddress: this.WALLET_ADDRESS_TRC20,
      network: 'TRC20',
      expiresAt,
    });

    await this.paymentRepo.save(payment);

    await this.userEventService.log({
      userId,
      type: EventType.PAYMENT_CREATED,
      metadata: {
        paymentId: payment.id,
        method: payment.method,
        amount: payment.amount,
      },
    });

    this.logger.log(
      `Crypto payment initiated: paymentId=${payment.id} user=${userId} amount=${amountCents}¢`,
    );

    return {
      paymentId: payment.id,
      walletAddress: this.WALLET_ADDRESS_TRC20,
      network: 'TRC20',
      amount: amountCents,
      currency: 'USDT',
      expiresAt,
    };
  }
}
