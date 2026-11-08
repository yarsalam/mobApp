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
    // Recover claims left behind by a crashed worker. Settlement effects use
    // durable idempotency receipts, so replay is safe even after partial work.
    await this.paymentRepo.update(
      { status: 'processing', updatedAt: LessThan(new Date(Date.now() - 10 * 60 * 1000)) },
      { status: 'pending' },
    );

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
    // Atomic claim: only one active verifier can move this payment from pending
    // to processing. A worker that lost the claim performs no external effects.
    const claim = await this.paymentRepo.update(
      { id: paymentId, status: 'pending' },
      { status: 'processing' },
    );
    if (!claim.affected) return;

    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId, status: 'processing' },
    });
    if (!payment) return;

    try {
      const confirmed = this.isMock
        ? await this.mockCheck(payment)
        : await this.checkTronGrid(payment);

      if (!confirmed) {
        await this.paymentRepo.update(
          { id: paymentId, status: 'processing' },
          { status: 'pending' },
        );
        return;
      }

      if (payment.currency !== 'USDT') {
        throw new Error(
          `Unsupported crypto wallet credit currency: ${payment.currency}`,
        );
      }

      // Payment.amount is stored in USDT cents, while the wallet balance is IRT rials.
      const amountRials = WalletService.usdtCentsToRials(Number(payment.amount));

      if (payment.productCode === 'wallet_charge') {
        await this.walletService.creditOnce(
          payment.userId,
          amountRials,
          `payment:${payment.id}`,
          `payment:${payment.id}:wallet-credit`,
        );
      } else {
        await this.entitlementService.grantFromPayment(payment, amountRials);
      }

      const settled = await this.paymentRepo.update(
        { id: paymentId, status: 'processing' },
        { status: 'paid', confirmedAt: new Date() },
      );
      if (!settled.affected) {
        const latest = await this.paymentRepo.findOne({ where: { id: paymentId } });
        if (latest?.status !== 'paid') {
          throw new Error(`Payment ${paymentId} lost its processing claim before settlement`);
        }
      }

      this.logger.log(
        `Crypto payment ${paymentId} confirmed for user ${payment.userId}; credited/granted value=${amountRials} IRT rials`,
      );
    } catch (error: unknown) {
      // Leave the payment retryable. Any completed credit/entitlement step is
      // protected by its own stable idempotency receipt.
      await this.paymentRepo.update(
        { id: paymentId, status: 'processing' },
        { status: 'pending' },
      );
      throw error;
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
      const expectedMicroUsdt = BigInt(Number(payment.amount)) * 10_000n;

      for (const tx of txs) {
        if (
          typeof tx.transaction_id !== 'string' ||
          typeof tx.value !== 'string' ||
          !tx.value.match(/^\\d+$/)
        ) {
          continue;
        }

        const txTime = Number(tx.block_timestamp);
        if (
          !Number.isFinite(txTime) ||
          txTime <= payment.createdAt.getTime() ||
          String(tx.to).toLowerCase() !== String(payment.walletAddress).toLowerCase()
        ) {
          continue;
        }

        // One on-chain transfer can settle only one payment. Overpayments are
        // held for manual reconciliation instead of being silently over-credited.
        const existingPayment = await this.paymentRepo.findOne({
          where: { txHash: tx.transaction_id },
        });
        if (existingPayment && existingPayment.id !== payment.id) {
          continue;
        }

        if (BigInt(tx.value) !== expectedMicroUsdt) {
          continue;
        }

        await this.paymentRepo.update(
          { id: payment.id, status: 'processing' },
          { txHash: tx.transaction_id },
        );
        return true;
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
