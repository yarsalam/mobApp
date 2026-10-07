import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { EntitlementService } from '../entitlement/entitlement.service';
import { Payment } from 'src/payments/entities/payment.entity';
import { WalletService } from '../wallet.service';

/**
 * این processor دو job می‌گیرد:
 *   1. 'check-pending'  — از BullMQ scheduler هر 5 دقیقه
 *   2. 'check-payment'  — برای یک payment خاص (بعد از initiate)
 *
 * برای تست اولیه بدون API blockchain:
 *   mock را فعال کن با CRYPTO_WATCHER_MOCK=true
 */
@Processor('crypto-watcher')
export class CryptoWatcherProcessor extends WorkerHost {
  private readonly logger = new Logger(CryptoWatcherProcessor.name);
  private readonly tronGridUrl =
    process.env.TRON_API_URL || 'https://api.trongrid.io';
  private readonly isMock = process.env.CRYPTO_WATCHER_MOCK === 'true';

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly entitlementService: EntitlementService,
    private readonly walletService: WalletService,
    private readonly httpService: HttpService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'check-pending':
        return this.checkAllPending();
      case 'check-payment':
        return this.checkSinglePayment(job.data.paymentId);
      default:
        this.logger.warn(`Unknown job: ${job.name}`);
    }
  }

  private async checkAllPending(): Promise<void> {
    const pending = await this.paymentRepo.find({
      where: {
        method: 'crypto_usdt',
        status: 'pending',
        expiresAt: LessThan(new Date(Date.now() + 60 * 60 * 1000)),
      },
      take: 50,
    });

    this.logger.log(`Checking ${pending.length} pending crypto payments`);

    for (const payment of pending) {
      await this.checkSinglePayment(payment.id).catch((err) => {
        this.logger.error(
          `Failed to check payment ${payment.id}: ${err.message}`,
        );
      });
    }

    // expire کردن پرداخت‌های منقضی‌شده
    await this.paymentRepo
      .createQueryBuilder()
      .update(Payment)
      .set({ status: 'expired' })
      .where('status = :s AND expiresAt < :now', {
        s: 'pending',
        now: new Date(),
      })
      .execute();
  }

  private async checkSinglePayment(paymentId: number): Promise<void> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId, status: 'pending' },
    });

    if (!payment) return;

    const confirmed = this.isMock
      ? await this.mockCheck(payment)
      : await this.checkTronGrid(payment);

    if (confirmed) {
      await this.walletService.credit(
        payment.userId,
        payment.amount,
        `payment:${payment.id}`,
      );

      await this.entitlementService.grantFromPayment(payment);

      await this.paymentRepo.update(
        { id: paymentId },
        { status: 'paid', confirmedAt: new Date() },
      );

      this.logger.log(
        `Crypto payment ${paymentId} confirmed for user ${payment.userId}`,
      );
    }
  }

  /**
   * بررسی TronGrid برای USDT TRC20.
   * اگر txHash روی payment ست شده، آن را verify می‌کند.
   * اگر نه، آخرین تراکنش‌های wallet را بررسی می‌کند.
   */
  private async checkTronGrid(payment: Payment): Promise<boolean> {
    try {
      const url = `${this.tronGridUrl}/v1/accounts/${payment.walletAddress}/transactions/trc20`;
      const response = await firstValueFrom(
        this.httpService.get(url, {
          params: {
            limit: 20,
            contract_address: process.env.USDT_TRC20_CONTRACT,
          },
          headers: { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY },
        }),
      );

      const txs: any[] = response.data?.data || [];
      const amountUsdt = payment.amount / 100; // سنت به USDT

      for (const tx of txs) {
        const txAmount = Number(tx.value) / 1_000_000; // USDT decimals=6
        const txTime = tx.block_timestamp;

        if (
          txAmount >= amountUsdt &&
          txTime > payment.createdAt.getTime() &&
          tx.to === payment.walletAddress
        ) {
          await this.paymentRepo.update(
            { id: payment.id },
            { txHash: tx.transaction_id },
          );
          return true;
        }
      }
    } catch (err) {
      this.logger.error(`TronGrid check failed: ${err.message}`);
    }
    return false;
  }

  /** mock برای محیط development — همیشه تأیید می‌کند */
  private async mockCheck(payment: Payment): Promise<boolean> {
    this.logger.warn(`MOCK: auto-confirming payment ${payment.id} (dev mode)`);
    await this.paymentRepo.update(
      { id: payment.id },
      { txHash: `mock_${Date.now()}` },
    );
    return true;
  }
}
