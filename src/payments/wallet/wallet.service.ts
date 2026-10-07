import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserWallet } from './entities/user-wallet.entity';
import { UserEventService } from 'src/user-event/user-event.service';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(UserWallet)
    private readonly repo: Repository<UserWallet>,
    private readonly userEventService: UserEventService,
  ) {}

  /** دریافت یا ساخت wallet — اتمیک */
  async get(userId: number): Promise<UserWallet> {
    try {
      await this.repo.insert({ userId, balance: 0, currency: 'IRT' });
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
    const wallet = await this.repo.findOne({ where: { userId } });
    if (!wallet) throw new Error(`Wallet not found for user ${userId}`);
    return wallet;
  }

  /**
   * شارژ کیف پول — فقط بعد از تأیید پرداخت صدا زده می‌شود
   * amountRials: مثلاً 200000 = ۲۰۰,۰۰۰ ریال
   */
  async credit(
    userId: number,
    amountRials: number,
    source: string,
  ): Promise<UserWallet> {
    await this.get(userId);

    await this.repo
      .createQueryBuilder()
      .update(UserWallet)
      .set({ balance: () => `balance + ${amountRials}` })
      .where('userId = :userId', { userId })
      .execute();

    const wallet = await this.get(userId);

    await this.userEventService.log({
      userId,
      type: EventType.CREDITS_GRANTED,
      metadata: { amountRials, source, newBalance: wallet.balance },
    });

    this.logger.log(
      `Wallet credited: user=${userId} +${amountRials}ریال source=${source}`,
    );
    return wallet;
  }

  /**
   * برداشت از کیف پول — برای خرید محصول
   * اتمیک: اگر موجودی کافی نباشد BadRequestException می‌دهد
   */
  async debit(
    userId: number,
    amountRials: number,
    reason: string,
  ): Promise<UserWallet> {
    const wallet = await this.get(userId);

    if (Number(wallet.balance) < amountRials) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        required: amountRials,
        current: Number(wallet.balance),
      });
    }

    await this.repo
      .createQueryBuilder()
      .update(UserWallet)
      .set({ balance: () => `balance - ${amountRials}` })
      .where('userId = :userId AND balance >= :amount', {
        userId,
        amount: amountRials,
      })
      .execute();

    const updatedWallet = await this.get(userId);

    await this.userEventService.log({
      userId,
      type: EventType.CREDITS_SPENT,
      metadata: { amountRials, reason, newBalance: updatedWallet.balance },
    });

    this.logger.log(
      `Wallet debited: user=${userId} -${amountRials}ریال reason=${reason}`,
    );
    return updatedWallet;
  }

  async getBalance(userId: number): Promise<number> {
    const wallet = await this.get(userId);
    return Number(wallet.balance);
  }

  /** تبدیل USDT به ریال — نرخ موقت، بعداً از config بخوان */
  static usdtCentsToRials(amountCents: number): number {
    const USDT_TO_RIAL = 90000; // 1 USDT ≈ ۹۰,۰۰۰ تومان = ۹۰۰,۰۰۰ ریال
    return Math.floor((amountCents / 100) * USDT_TO_RIAL * 10);
  }
}
