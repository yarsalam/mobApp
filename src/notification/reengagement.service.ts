import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Inject } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Redis } from 'ioredis';
import { User } from 'src/users/entities/user.entity';
import { UserDevice } from 'src/user-device/entities/user-device.entity';
import { REDIS_CLIENT } from 'src/redis/redis.constants';
import { NotificationService } from './notification.service';
import { NotificationType } from './entities/notification.entity';

type ReengagementStage = '1d' | '7d' | '30d';

@Injectable()
export class ReengagementService {
  private readonly logger = new Logger(ReengagementService.name);
  private readonly dayMs = 24 * 60 * 60 * 1000;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserDevice)
    private readonly deviceRepo: Repository<UserDevice>,
    private readonly notificationService: NotificationService,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  private getStage(inactiveDays: number): ReengagementStage | null {
    if (inactiveDays >= 30) return '30d';
    if (inactiveDays >= 7) return '7d';
    if (inactiveDays >= 1) return '1d';
    return null;
  }

  private isWithinContactHours(
    timezone: string | null | undefined,
    now: Date,
  ): boolean {
    if (!timezone) return false;
    try {
      const hourText = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(now);
      const hour = Number(hourText);
      return Number.isInteger(hour) && hour >= 9 && hour < 21;
    } catch {
      return false;
    }
  }

  private async getEligibleDeviceTimezone(
    userId: number,
    now: Date,
  ): Promise<string | undefined> {
    // Device metadata (including timezone) is collected by Yarsalam itself.
    // No push registration/token is required for an in-app reminder.
    const devices = await this.deviceRepo
      .createQueryBuilder('device')
      .select(['device.id', 'device.timezone', 'device.updatedAt'])
      .where('device.userId = :userId', { userId })
      .orderBy('device.updatedAt', 'DESC')
      .getMany();

    return devices.find((device) =>
      this.isWithinContactHours(device.timezone, now),
    )?.timezone;
  }

  @Cron('0 * * * *')
  async scheduleReengagement(): Promise<void> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - this.dayMs);
    const candidates = await this.userRepo
      .createQueryBuilder('user')
      .select(['user.id', 'user.lastActive'])
      .where('user.status = :status', { status: 'active' })
      .andWhere('user.lastActive IS NOT NULL')
      .andWhere('user.lastActive <= :cutoff', { cutoff: oneDayAgo })
      .orderBy('user.lastActive', 'ASC')
      .take(500)
      .getMany();

    let considered = 0;
    let scheduled = 0;

    for (const candidate of candidates) {
      if (!candidate.lastActive) continue;
      const inactiveDays = Math.floor(
        (now.getTime() - new Date(candidate.lastActive).getTime()) / this.dayMs,
      );
      const stage = this.getStage(inactiveDays);
      if (!stage) continue;

      // Re-read activity before claiming a reminder so a returning user is
      // not notified based on a stale candidate snapshot.
      const current = await this.userRepo.findOne({
        where: { id: candidate.id, status: 'active' },
        select: ['id', 'lastActive'],
      });
      if (!current?.lastActive) continue;

      const currentInactiveDays = Math.floor(
        (now.getTime() - new Date(current.lastActive).getTime()) / this.dayMs,
      );
      if (this.getStage(currentInactiveDays) !== stage) continue;

      const timezone = await this.getEligibleDeviceTimezone(candidate.id, now);
      if (!timezone) continue;
      considered += 1;

      const episode = new Date(current.lastActive).toISOString();
      const stageKey = `reengagement:scheduled:${candidate.id}:${stage}:${episode}`;
      const claimed = await this.redis.set(
        stageKey,
        '1',
        'EX',
        45 * 24 * 60 * 60,
        'NX',
      );
      if (claimed !== 'OK') continue;

      const rateKey = `reengagement:rolling-30d:${candidate.id}`;
      const cutoff = now.getTime() - 30 * this.dayMs;
      await this.redis.zremrangebyscore(rateKey, '-inf', cutoff);
      await this.redis.zadd(rateKey, 'NX', now.getTime(), `${stage}:${episode}`);
      const count = await this.redis.zcard(rateKey);
      await this.redis.expire(rateKey, 31 * 24 * 60 * 60);
      if (count > 3) continue;

      const messages: Record<ReengagementStage, string> = {
        '1d': 'هر وقت فرصت داشتی، می‌توانی دوباره به یارسلام سر بزنی.',
        '7d': 'اگر هنوز مایل هستی، گفتگوها و پیشنهادهایت در یارسلام در دسترس‌اند.',
        '30d': 'مدتی است ندیدیمت؛ هر زمان خواستی، می‌توانی به یارسلام برگردی.',
      };

      try {
        await this.notificationService.createNotification({
          user_id: candidate.id,
          type: NotificationType.REENGAGEMENT,
          message: messages[stage],
        });
        scheduled += 1;
      } catch (error: unknown) {
        await this.redis.del(stageKey);
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Could not persist re-engagement notification for user ${candidate.id}: ${message}`,
        );
      }
    }

    this.logger.log(
      `In-app re-engagement scan complete: ${candidates.length} candidates, ${considered} eligible, ${scheduled} notifications persisted`,
    );
  }
}
