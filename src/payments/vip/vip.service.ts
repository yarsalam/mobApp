import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async expireVip(userId: number) {
    await this.repo.update({ userId, active: true }, { active: false });

    await this.userEventService.log({
      userId,
      type: EventType.VIP_EXPIRED,
      metadata: {},
    });
  }
}
