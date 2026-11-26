import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { UserBoost } from './entities/user-boost.entity';
import { PaywallException } from '../paywall/paywall.exception';
import { PhaseService } from '../../phase/phase.service';
import { UserEventService } from 'src/user-event/user-event.service';
import { BoostQueueService } from 'src/redis/boost-queue.service';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class BoostService {
  constructor(
    @InjectRepository(UserBoost)
    private readonly repo: Repository<UserBoost>,
    private readonly phaseService: PhaseService,
    private readonly userEventService: UserEventService,
    private readonly boostQueueService: BoostQueueService,
    private readonly dataSource: DataSource,
  ) {}

  async get(userId: number) {
    await this.repo
      .createQueryBuilder()
      .insert()
      .values({ user: { id: userId } as any, instantCount: 0 })
      .orIgnore()
      .execute();
    const boost = await this.repo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });
    if (!boost) throw new Error('Unable to initialize user boosts');
    return boost;
  }

  isActive(boost: UserBoost) {
    return boost.activeUntil && boost.activeUntil > new Date();
  }

  async activateInstant(userId: number) {
    const boost = await this.get(userId);
    const activeUntil = new Date(Date.now() + 30 * 60 * 1000);

    const updated = await this.dataSource.transaction(async (manager) => {
      const boosts = manager.getRepository(UserBoost);
      const debit = await boosts
        .createQueryBuilder()
        .update(UserBoost)
        .set({
          instantCount: () => 'instantCount - 1',
          activeUntil,
          strength: 1,
        })
        .where('id = :id AND instantCount > 0', { id: boost.id })
        .execute();

      if (!debit.affected) {
        throw new PaywallException({ type: 'boost', message: 'Boost ندارید' });
      }

      const saved = await boosts.findOne({
        where: { id: boost.id },
        relations: ['user'],
      });
      if (!saved) throw new Error('Boost entitlement disappeared during activation');

      await this.userEventService.logWithManager(manager, {
        userId,
        type: EventType.BOOST_USED,
        metadata: { type: 'instant' },
      });
      return saved;
    });

    await this.boostQueueService.enqueue(userId, {
      strength: updated.strength,
      expiresAt: updated.activeUntil,
      source: 'instant',
    });

    await this.phaseService.learnFromFeedback(userId, 'boost_used');
    return updated;
  }

  async activateMonthly(userId: number, strength = 2) {
    const boost = await this.get(userId);

    boost.monthlyUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    boost.activeUntil = boost.monthlyUntil;
    boost.strength = strength;

    await this.repo.save(boost);
    if (!boost.activeUntil) return;

    await this.boostQueueService.enqueue(userId, {
      strength: boost.strength,
      expiresAt: boost.activeUntil,
      source: 'instant',
    });

    await this.userEventService.log({
      userId,
      type: EventType.BOOST_USED,
      metadata: { type: 'monthly' },
    });

    return boost;
  }

  async grantInstant(userId: number, count: number) {
    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new Error('Boost grant count must be a positive safe integer');
    }
    await this.get(userId); // اطمینان از وجود رکورد
    // رفع race condition: استفاده از increment اتمیک
    await this.repo.increment(
      { user: { id: userId } } as any,
      'instantCount',
      count,
    );
    return this.get(userId);
  }

  /**
   * Idempotent bundle grant. The boost increment and durable receipt share one
   * transaction, so retrying a partially fulfilled bundle cannot add boosts twice.
   */
  async grantInstantOnce(
    userId: number,
    count: number,
    idempotencyKey: string,
    bundleCode: string,
  ) {
    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new Error('Boost grant count must be a positive safe integer');
    }
    if (!idempotencyKey?.trim() || idempotencyKey.length > 128) {
      throw new Error('A stable idempotency key is required for boost grants');
    }

    await this.dataSource.transaction(async (manager) => {
      const events = manager.getRepository(PartitionedEvent);
      const existing = await events.findOne({
        where: { userId, idempotencyKey },
      });
      if (existing) {
        const metadata = existing.metadata ?? {};
        if (
          existing.type !== EventType.PURCHASE ||
          metadata.entitlement !== 'boost' ||
          Number(metadata.amount) !== count ||
          metadata.bundleCode !== bundleCode
        ) {
          throw new Error('Idempotency key was already used for a different boost grant');
        }
        return;
      }

      const boosts = manager.getRepository(UserBoost);
      await boosts
        .createQueryBuilder()
        .insert()
        .values({ user: { id: userId } as any, instantCount: 0 })
        .orIgnore()
        .execute();
      await boosts.increment({ user: { id: userId } } as any, 'instantCount', count);

      await this.userEventService.logWithManager(manager, {
        userId,
        type: EventType.PURCHASE,
        metadata: {
          entitlement: 'boost',
          amount: count,
          bundleCode,
          source: 'bundle_fulfillment_receipt',
          isCommercialPurchase: false,
        },
        idempotencyKey,
      });
    });

    return this.get(userId);
  }

  async grantFreeOnce(userId: number) {
    const boost = await this.get(userId);
    if (boost.freeGranted) return boost;

    const phase = await this.phaseService.get(userId);
    if (phase.phase !== 'cold') return boost;

    await this.repo
      .createQueryBuilder()
      .update(UserBoost)
      .set({
        instantCount: () => 'instantCount + 1',
        freeGranted: true,
      })
      .where('id = :id AND freeGranted = :freeGranted', {
        id: boost.id,
        freeGranted: false,
      })
      .execute();

    // A conditional update means concurrent calls can grant this only once.
    return this.get(userId);
  }
