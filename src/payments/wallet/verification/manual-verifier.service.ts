import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from 'src/payments/entities/payment.entity';
import { WalletService } from '../wallet.service';
import { UserEventService } from 'src/user-event/user-event.service';
import { EventType } from 'src/user-event/type/event-type.enum';

/**
 * ManualVerifierService
 *
 * ادمین پرداخت کارت‌به‌کارت را تأیید می‌کند.
 * فقط wallet شارژ می‌شود — grant محصول در این مرحله انجام نمی‌شود.
 * کاربر بعداً از فروشگاه خرید می‌کند (wallet.debit → grantBundle).
 */
@Injectable()
export class ManualVerifierService {
  private readonly logger = new Logger(ManualVerifierService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly walletService: WalletService,
    private readonly userEventService: UserEventService,
  ) {}

  async confirm(paymentId: number, adminNote?: string): Promise<void> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
    });

    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);

    if (payment.status !== 'pending') {
      throw new BadRequestException(
        `Payment ${paymentId} is already ${payment.status}`,
      );
    }

    if (payment.method !== 'manual_card') {
      throw new BadRequestException(
        `ManualVerifier only handles manual_card payments`,
      );
    }

    // شارژ wallet به ریال — مبلغ payment ریاله
    await this.walletService.credit(
      payment.userId,
      payment.amount, // ریال مستقیم
      `payment:${payment.id}`,
    );

    await this.paymentRepo.update(
      { id: paymentId },
      {
        status: 'paid',
        confirmedAt: new Date(),
        metadata: {
          ...(payment.metadata ?? {}),
          adminNote: adminNote ?? null,
          confirmedBy: 'admin',
        } as any,
      },
    );

    await this.userEventService.log({
      userId: payment.userId,
      type: EventType.PAYMENT_CONFIRMED,
      metadata: {
        paymentId,
        method: payment.method,
        amount: payment.amount,
        walletCredited: true,
      },
    });

    this.logger.log(
      `Payment ${paymentId} confirmed → wallet +${payment.amount}ریال for user ${payment.userId}`,
    );
  }

  async reject(paymentId: number, reason: string): Promise<void> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId, status: 'pending' },
    });

    if (!payment)
      throw new NotFoundException(`Pending payment ${paymentId} not found`);

    await this.paymentRepo.update(
      { id: paymentId },
      {
        status: 'failed',
        metadata: {
          ...(payment.metadata ?? {}),
          rejectReason: reason,
        } as any,
      },
    );

    this.logger.log(`Payment ${paymentId} rejected: ${reason}`);
  }
}
