import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Payment } from 'src/payments/entities/payment.entity';
import { EventType } from 'src/user-event/type/event-type.enum';
import { UserEventService } from 'src/user-event/user-event.service';
import { Repository } from 'typeorm';

export interface CardTransferInitResult {
  paymentId: number;
  cardNumber: string;
  accountHolder: string;
  amount: number;
  currency: 'IRT';
  expiresAt: Date;
}

@Injectable()
export class CardTransferProvider {
  private readonly logger = new Logger(CardTransferProvider.name);

  /**
   * شماره کارت مقصد — از config یا DB می‌آید.
   * فعلاً hardcode؛ بعداً از ConfigService بخوان.
   */
  private readonly DESTINATION_CARD = process.env.CARD_TRANSFER_NUMBER || '';
  private readonly ACCOUNT_HOLDER =
    process.env.CARD_TRANSFER_HOLDER || 'یارسلام';

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly userEventService: UserEventService,
  ) {}

  async initiate(
    userId: number,
    productCode: string,
    amountRials: number,
  ): Promise<CardTransferInitResult> {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 دقیقه

    const payment = this.paymentRepo.create({
      userId,
      productCode,
      amount: amountRials,
      currency: 'IRT',
      method: 'manual_card',
      status: 'pending',
      expiresAt,
      metadata: { cardNumber: this.DESTINATION_CARD },
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
      `CardTransfer initiated: paymentId=${payment.id} user=${userId} amount=${amountRials}`,
    );

    return {
      paymentId: payment.id,
      cardNumber: this.DESTINATION_CARD,
      accountHolder: this.ACCOUNT_HOLDER,
      amount: amountRials,
      currency: 'IRT',
      expiresAt,
    };
  }

  /**
   * کاربر رسید آپلود کرد — منتظر تأیید ادمین.
   */
  async submitProof(paymentId: number, proofUrl: string): Promise<void> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId, status: 'pending' },
    });
    if (!payment) return;

    payment.proofUrl = proofUrl;
    payment.metadata = {
      ...(payment.metadata ?? {}),
      proofSubmittedAt: new Date().toISOString(),
    };

    await this.paymentRepo.save(payment);
  }
}
