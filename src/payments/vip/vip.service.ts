import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { UserVip } from './entities/vip.entity';
import { UserEventService } from 'src/user-event/user-event.service';
import { BoostQueueService } from 'src/redis/boost-queue.service';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class VipService {
  constructor(
    @InjectRepository(UserVip)
    private readonly repo: Repository<UserVip>,
    private readonly userEventService: UserEventService,
    private readonly boostQueueService: BoostQueueService,
    private readonly dataSource: DataSource,
  ) {}

  async hasVip(userId: number): Promise<boolean> {
    const vip = await this.repo.findOne({
      where: { userId, active: true },
      order: { expiresAt: 'DESC' },
    });
    return !!vip && vip.expiresAt > new Date();
  }

  async activateVip(userId: number, durationDays: number) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    // رفع: تمدید اگر VIP فعال دارد، ساخت رکورد جدید اگر ندارد
    const existing = await this.repo.findOne({
      where: { userId, active: true },
      order: { expiresAt: 'DESC' },
    });

    let vip: UserVip;
    if (existing && existing.expiresAt > new Date()) {
      // تمدید از تاریخ انقضای فعلی
      existing.expiresAt = new Date(existing.expiresAt.getTime());
      existing.expiresAt.setDate(existing.expiresAt.getDate() + durationDays);
      vip = await this.repo.save(existing);
    } else {
      vip = this.repo.create({ userId, active: true, expiresAt });
      vip = await this.repo.save(vip);
    }

    await this.boostQueueService.enqueueVip(userId, vip.expiresAt);

    await this.userEventService.log({
      userId,
      type: EventType.VIP_ACTIVATED,
      metadata: {
        durationDays,
        expiresAt: vip.expiresAt.toISOString(),
      },
    });

    return vip;
  }

  /**
   * Idempotent, resumable VIP bundle grant. VIP extension and its durable
   * receipt commit together; a repeated fulfillment cannot extend the term twice.
   */
  async activateVipOnce(
    userId: number,
    durationDays: number,
    idempotencyKey: string,
    bundleCode: string,
  ) {
    if (!Number.isSafeInteger(durationDays) || durationDays <= 0) {
      throw new Error('VIP duration must be a positive safe integer');
    }
    if (!idempotencyKey?.trim() || idempotencyKey.length > 128) {
      throw new Error('A stable idempotency key is required for VIP grants');
    }

    await this.dataSource.transaction(async (manager) => {
      const events = manager.getRepository(PartitionedEvent);
      const existingEvent = await events.findOne({
        where: { userId, idempotencyKey },
      });
      if (existingEvent) {
        const metadata = existingEvent.metadata ?? {};
        if (
          existingEvent.type !== EventType.VIP_ACTIVATED ||
          Number(metadata.durationDays) !== durationDays ||
          metadata.bundleCode !== bundleCode
        ) {
          throw new Error('Idempotency key was already used for a different VIP grant');
        }
        return;
      }

      const vipRepo = manager.getRepository(UserVip);
      const now = new Date();
      const existingVip = await vipRepo.findOne({
        where: { userId, active: true },
        order: { expiresAt: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });

      let expiresAt: Date;
      if (existingVip && existingVip.expiresAt > now) {
        expiresAt = new Date(existingVip.expiresAt);
        expiresAt.setDate(expiresAt.getDate() + durationDays);
        await vipRepo.update({ id: existingVip.id }, { expiresAt, active: true });
      } else {
        expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() + durationDays);
        await vipRepo.save(vipRepo.create({ userId, active: true, expiresAt }));
      }

      await this.userEventService.logWithManager(manager, {
        userId,
        type: EventType.VIP_ACTIVATED,
        metadata: {
          durationDays,
          expiresAt: expiresAt.toISOString(),
          bundleCode,
          source: 'bundle_fulfillment',
        },
        idempotencyKey,
      });
    });

    const vip = await this.repo.findOne({
      where: { userId, active: true },
      order: { expiresAt: 'DESC' },
    });
    if (vip) {
      // Re-enqueue on retries as a repair for a process crash after DB commit.
      await this.boostQueueService.enqueueVip(userId, vip.expiresAt);
    }
    return vip;
  }

  async expireVip(userId: number) {
    await this.repo.update({ userId, active: true }, { active: false });

    await this.userEventService.log({
      userId,
      type: EventType.VIP_EXPIRED,
      metadata: {},
    });
  }
}
