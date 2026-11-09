import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
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
    private readonly dataSource: DataSource,
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
    if (!Number.isSafeInteger(amountRials) || amountRials <= 0) {
      throw new BadRequestException('amountRials must be a positive safe integer');
    }

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
   * Idempotent wallet credit. The balance update and its durable event receipt
   * are committed together, so a retry after a worker crash cannot double-credit.
   */
  async creditOnce(
    userId: number,
    amountRials: number,
    source: string,
    idempotencyKey: string,
  ): Promise<UserWallet> {
    if (!Number.isSafeInteger(amountRials) || amountRials <= 0) {
      throw new BadRequestException('amountRials must be a positive safe integer');
    }
    if (!idempotencyKey?.trim() || idempotencyKey.length > 128) {
      throw new BadRequestException('A stable idempotency key is required');
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        const eventRepo = manager.getRepository(PartitionedEvent);
        const existing = await eventRepo.findOne({
          where: { userId, idempotencyKey },
        });
        if (existing) {
          const metadata = existing.metadata ?? {};
          if (
            existing.type !== EventType.CREDITS_GRANTED ||
            Number(metadata.amountRials) !== amountRials ||
            metadata.source !== source
          ) {
            throw new BadRequestException('Idempotency key was already used for a different wallet credit');
          }
          return;
        }

        const walletRepo = manager.getRepository(UserWallet);
        await walletRepo
          .createQueryBuilder()
          .insert()
          .values({ userId, balance: 0, currency: 'IRT' })
          .orIgnore()
          .execute();

        const update = await walletRepo
          .createQueryBuilder()
          .update(UserWallet)
          .set({ balance: () => `balance + ${amountRials}` })
          .where('userId = :userId', { userId })
          .execute();
        if (!update.affected) throw new Error(`Wallet credit affected no rows for user ${userId}`);

        const wallet = await walletRepo.findOne({ where: { userId } });
        if (!wallet) throw new Error(`Wallet not found for user ${userId}`);

        await this.userEventService.logWithManager(manager, {
          userId,
          type: EventType.CREDITS_GRANTED,
          metadata: {
            amountRials,
            source,
            newBalance: Number(wallet.balance),
            idempotent: true,
          },
          idempotencyKey,
        });
      });
    } catch (error: unknown) {
      const duplicate = error as { code?: string; errno?: number };
      if (duplicate.code !== 'ER_DUP_ENTRY' && duplicate.errno !== 1062) {
        throw error;
      }

      // In a concurrent retry, the unique receipt insert can make this
      // transaction roll back after its initial read saw no receipt. Accept
      // only after the winning transaction has committed an identical event.
      const receipt = await this.dataSource
        .getRepository(PartitionedEvent)
        .findOne({ where: { userId, idempotencyKey } });
      if (!receipt) throw error;

      const metadata = receipt.metadata ?? {};
      if (
        receipt.type !== EventType.CREDITS_GRANTED ||
        Number(metadata.amountRials) !== amountRials ||
        metadata.source !== source
      ) {
        throw new BadRequestException('Idempotency key was already used for a different wallet credit');
      }
    }

    return this.get(userId);
  }

  /**
   * Idempotent wallet debit. Balance mutation and its spend event share one
   * transaction; repeated checkout requests with the same key are no-ops.
   */
  async debitOnce(
    userId: number,
    amountRials: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<UserWallet> {
    if (!Number.isSafeInteger(amountRials) || amountRials <= 0) {
      throw new BadRequestException('amountRials must be a positive safe integer');
    }
    if (!idempotencyKey?.trim() || idempotencyKey.length > 128) {
      throw new BadRequestException('A stable idempotency key is required');
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        const eventRepo = manager.getRepository(PartitionedEvent);
        const existing = await eventRepo.findOne({
          where: { userId, idempotencyKey },
        });
        if (existing) {
          const metadata = existing.metadata ?? {};
          if (
            existing.type !== EventType.CREDITS_SPENT ||
            Number(metadata.amountRials) !== amountRials ||
            metadata.reason !== reason
          ) {
            throw new BadRequestException('Idempotency key was already used for a different wallet debit');
          }
          return;
        }

        const walletRepo = manager.getRepository(UserWallet);
        await walletRepo
          .createQueryBuilder()
          .insert()
          .values({ userId, balance: 0, currency: 'IRT' })
          .orIgnore()
          .execute();

        const debit = await walletRepo
          .createQueryBuilder()
          .update(UserWallet)
          .set({ balance: () => `balance - ${amountRials}` })
          .where('userId = :userId AND balance >= :amount', {
            userId,
            amount: amountRials,
          })
          .execute();
        if (!debit.affected) {
          const latest = await walletRepo.findOne({ where: { userId } });
          throw new BadRequestException({
            code: 'INSUFFICIENT_BALANCE',
            required: amountRials,
            current: Number(latest?.balance ?? 0),
          });
        }

        const wallet = await walletRepo.findOne({ where: { userId } });
        if (!wallet) throw new Error(`Wallet not found for user ${userId}`);

        await this.userEventService.logWithManager(manager, {
          userId,
          type: EventType.CREDITS_SPENT,
          metadata: {
            amountRials,
            reason,
            newBalance: Number(wallet.balance),
            idempotent: true,
          },
          idempotencyKey,
        });
      });
    } catch (error: unknown) {
      const duplicate = error as { code?: string; errno?: number };
      if (duplicate.code !== 'ER_DUP_ENTRY' && duplicate.errno !== 1062) {
        throw error;
      }

      const receipt = await this.dataSource
        .getRepository(PartitionedEvent)
        .findOne({ where: { userId, idempotencyKey } });
      if (!receipt) throw error;

      const metadata = receipt.metadata ?? {};
      if (
        receipt.type !== EventType.CREDITS_SPENT ||
        Number(metadata.amountRials) !== amountRials ||
        metadata.reason !== reason
      ) {
        throw new BadRequestException('Idempotency key was already used for a different wallet debit');
      }
    }

    return this.get(userId);
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
