import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
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
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new BadRequestException('Invalid userId');
    }
    if (!Number.isSafeInteger(amountRials) || amountRials <= 0) {
      throw new BadRequestException('amountRials must be a positive safe integer');
    }
    const normalizedCard = this.DESTINATION_CARD.replace(/[\\s-]/g, '');
    if (!/^\\d{16}$/.test(normalizedCard)) {
      throw new ServiceUnavailableException(
        'Card transfer is not configured. Contact support or use another payment method.',
      );
    }

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
      cardNumber: normalizedCard,
      accountHolder: this.ACCOUNT_HOLDER,
      amount: amountRials,
      currency: 'IRT',
      expiresAt,
    };
  }

  /**
   * کاربر رسید آپلود کرد — منتظر تأیید ادمین.
   */
  async submitProof(
    paymentId: number,
    userId: number,
    proofUrl: string,
  ): Promise<void> {
    const normalizedProofUrl = typeof proofUrl === 'string' ? proofUrl.trim() : '';
    if (!normalizedProofUrl || normalizedProofUrl.length > 2048) {
      throw new BadRequestException('A valid proof reference is required');
    }

    // Scope both the read and the write to the authenticated owner. The
    // conditional update also prevents a late proof upload from overwriting a
    // payment that an admin/worker has already moved out of pending state.
    const payment = await this.paymentRepo.findOne({
      where: {
        id: paymentId,
        userId,
        status: 'pending',
        method: 'manual_card',
      },
    });
    if (!payment) {
      throw new NotFoundException('Pending payment not found');
    }

    const result = await this.paymentRepo.update(
      {
        id: paymentId,
        userId,
        status: 'pending',
        method: 'manual_card',
      },
      {
        proofUrl: normalizedProofUrl,
        metadata: {
          ...(payment.metadata ?? {}),
          proofSubmittedAt: new Date().toISOString(),
        } as any,
      },
    );
    if (!result.affected) {
      throw new NotFoundException('Pending payment not found');
    }
  }
}
