import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
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
    const claim = await this.paymentRepo.update(
      { id: paymentId, status: 'pending', method: 'manual_card' },
      { status: 'processing' },
    );
    if (!claim.affected) {
      const latest = await this.paymentRepo.findOne({ where: { id: paymentId } });
      if (!latest) throw new NotFoundException(`Payment ${paymentId} not found`);
      throw new BadRequestException(
        `Payment ${paymentId} cannot be confirmed from status ${latest.status}`,
      );
    }

    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId, status: 'processing', method: 'manual_card' },
    });
    if (!payment) {
      await this.paymentRepo.update(
        { id: paymentId, status: 'processing' },
        { status: 'pending' },
      );
      throw new NotFoundException(`Claimed manual payment ${paymentId} not found`);
    }

    try {
      // The wallet increment and receipt are atomic. A retry after a crash
      // between credit and payment-status update safely observes the receipt.
      await this.walletService.creditOnce(
        payment.userId,
        payment.amount,
        `payment:${payment.id}`,
        `payment:${payment.id}:wallet-credit`,
      );

      await this.userEventService.log({
        userId: payment.userId,
        type: EventType.PAYMENT_CONFIRMED,
        metadata: {
          paymentId,
          method: payment.method,
          amount: payment.amount,
          walletCredited: true,
          adminNote: adminNote ?? null,
        },
        idempotencyKey: `payment:${payment.id}:confirmed`,
      });

      const settled = await this.paymentRepo.update(
        { id: paymentId, status: 'processing' },
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
      if (!settled.affected) {
        const latest = await this.paymentRepo.findOne({ where: { id: paymentId } });
        if (latest?.status !== 'paid') {
          throw new Error(`Manual payment ${paymentId} lost its processing claim`);
        }
      }

      this.logger.log(
        `Payment ${paymentId} confirmed → wallet +${payment.amount}ریال for user ${payment.userId}`,
      );
    } catch (error) {
      await this.paymentRepo.update(
        { id: paymentId, status: 'processing' },
        { status: 'pending' },
      );
      throw error;
    }
  }

  /**
   * A crashed manual confirmation must not leave a payment locked forever.
   * The admin can safely confirm it again because wallet credit has a durable
   * idempotency receipt.
   */
  @Cron('*/5 * * * *')
  async recoverStaleManualClaims(): Promise<void> {
    const result = await this.paymentRepo.update(
      {
        method: 'manual_card',
        status: 'processing',
        updatedAt: LessThan(new Date(Date.now() - 10 * 60 * 1000)),
      },
      { status: 'pending' },
    );
    if (result.affected) {
      this.logger.warn(`Recovered ${result.affected} stale manual payment confirmation claim(s)`);
    }
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
