import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  ) {}

  async get(userId: number) {
    let boost = await this.repo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!boost) {
      boost = this.repo.create({
        user: { id: userId } as any,
        instantCount: 0,
      });
      await this.repo.save(boost);
    }
    return boost;
  }

  isActive(boost: UserBoost) {
    return boost.activeUntil && boost.activeUntil > new Date();
  }

  async activateInstant(userId: number) {
    const boost = await this.get(userId);

    if (boost.instantCount <= 0) {
      throw new PaywallException({ type: 'boost', message: 'Boost ندارید' });
    }

    // رفع race condition: استفاده از decrement اتمیک
    await this.repo.decrement({ id: boost.id }, 'instantCount', 1);

    boost.activeUntil = new Date(Date.now() + 30 * 60 * 1000);
    boost.strength = 1;
    await this.repo.save(boost);

    await this.boostQueueService.enqueue(userId, {
      strength: boost.strength,
      expiresAt: boost.activeUntil,
      source: 'instant',
    });

    await this.userEventService.log({
      userId,
      type: EventType.BOOST_USED,
      metadata: { type: 'instant' },
    });

    await this.phaseService.learnFromFeedback(userId, 'boost_used');
    return boost;
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
    await this.get(userId); // اطمینان از وجود رکورد
    // رفع race condition: استفاده از increment اتمیک
    await this.repo.increment(
      { user: { id: userId } } as any,
      'instantCount',
      count,
    );
    return this.get(userId);
  }

  async grantFreeOnce(userId: number) {
    const boost = await this.get(userId);
    if (boost.freeGranted) return;

    const phase = await this.phaseService.get(userId);
    if (phase.phase !== 'cold') return;

    await this.repo.increment({ id: boost.id }, 'instantCount', 1);
    await this.repo.update({ id: boost.id }, { freeGranted: true });
    return this.get(userId);
  }
}
