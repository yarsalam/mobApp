import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { UserCredits } from './entities/user-credits.entity';
import { UserEventService } from 'src/user-event/user-event.service';
import { PaywallException } from '../paywall/paywall.exception';
import { BoostQueueService } from 'src/redis/boost-queue.service';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class CreditsService {
  constructor(
    @InjectRepository(UserCredits)
    private readonly repo: Repository<UserCredits>,
    private readonly userEventService: UserEventService,
    private readonly boostQueueService: BoostQueueService,
    private readonly dataSource: DataSource,
  ) {}

  async get(userId: number) {
    let credits = await this.repo.findOne({ where: { userId } });
    if (!credits) {
      credits = this.repo.create({ userId, balance: 0 });
      await this.repo.save(credits);
    }
    return credits;
  }

  /** بهتر است از upsert استفاده کنیم تا race condition کمتر شود */
  async ensureExists(userId: number): Promise<UserCredits> {
    try {
      await this.repo.insert({ userId, balance: 0 });
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
    return this.get(userId);
  }

  async consume(userId: number, amount: number, reason: string) {
    await this.ensureExists(userId); // اطمینان از وجود رکورد
    const current = await this.get(userId);
    if (current.balance < amount) {
      throw new PaywallException({
        type: 'credits',
        reason,
        required: amount,
        balance: current.balance,
      });
    }

    await this.repo.decrement({ userId }, 'balance', amount);

    await this.userEventService.log({
      userId,
      type: EventType.CREDITS_SPENT,
      metadata: { amount, reason },
    });

    return this.get(userId);
  }

  /**
   * Purchase-specific grant with a durable receipt committed atomically with
   * the balance increment. Safe to resume after a worker/process crash.
   */
  async grantOnce(userId: number, amount: number, idempotencyKey: string) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error('Credit grant amount must be a positive safe integer');
    }
    if (!idempotencyKey?.trim() || idempotencyKey.length > 128) {
      throw new Error('A stable idempotency key is required for credit grants');
    }

    await this.dataSource.transaction(async (manager) => {
      const events = manager.getRepository(PartitionedEvent);
      const existing = await events.findOne({
        where: { userId, idempotencyKey },
      });
      if (existing) {
        const metadata = existing.metadata ?? {};
        if (
          existing.type !== EventType.CREDITS_GRANTED ||
          Number(metadata.amount) !== amount ||
          metadata.source !== 'bundle_fulfillment'
        ) {
          throw new Error('Idempotency key was already used for a different credit grant');
        }
        return;
      }

      const credits = manager.getRepository(UserCredits);
      await credits
        .createQueryBuilder()
        .insert()
        .values({ userId, balance: 0 })
        .orIgnore()
        .execute();
      await credits.increment({ userId }, 'balance', amount);

      const saved = await credits.findOne({ where: { userId } });
      await this.userEventService.logWithManager(manager, {
        userId,
        type: EventType.CREDITS_GRANTED,
        metadata: { amount, source: 'bundle_fulfillment', balance: saved?.balance ?? null },
        idempotencyKey,
      });
    });

    const saved = await this.get(userId);
    // Queue side effects are safe to repeat; this also repairs a lost enqueue
    // if the process stopped after committing the entitlement transaction.
    if (saved.balance >= 100) {
      await this.boostQueueService.enqueueHighCredit(userId, saved.balance);
    }
    return saved;
  }

  async grant(userId: number, amount: number) {
    await this.ensureExists(userId);

    await this.repo.increment({ userId }, 'balance', amount);

    const saved = await this.get(userId);

    await this.userEventService.log({
      userId,
      type: EventType.CREDITS_GRANTED,
      metadata: { amount, source: 'grant' },
    });

    if (saved.balance >= 100) {
      await this.boostQueueService.enqueueHighCredit(userId, saved.balance);
    }

    return saved;
  }
}
