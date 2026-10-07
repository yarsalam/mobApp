import { Injectable, Logger, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

interface ActiveBoost {
  userId: number;
  strength: number;
  expiresIn: number;
}

const BOOST_QUEUE_KEY = 'boost:v1:queue';
const BOOST_META_KEY = (userId: number) => `boost:v1:meta:${userId}`;
const BOOST_DAILY_KEY = (userId: number) =>
  `boost:daily:${userId}:${new Date().toISOString().split('T')[0]}`;

@Injectable()
export class BoostQueueService {
  private readonly logger = new Logger(BoostQueueService.name);
  private readonly MAX_BOOSTS_PER_DAY = 5;

  constructor(
    // رفع: استفاده از REDIS_CLIENT inject‌شده به جای ساخت instance جدید
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async enqueue(
    userId: number,
    options: {
      strength: number;
      expiresAt: Date;
      source: 'instant' | 'monthly' | 'vip';
    },
  ) {
    const can = await this.canEnqueue(userId);
    if (!can) {
      throw new Error('محدودیت روزانه بوست - حداکثر ۵ بار در روز');
    }

    const { strength, expiresAt } = options;
    const now = Date.now();
    const priority = strength * 10_000;
    const score = now - priority;

    await this.redis.zadd(BOOST_QUEUE_KEY, score.toString(), userId.toString());
    await this.redis.hset(BOOST_META_KEY(userId), {
      strength: strength.toString(),
      expiresAt: expiresAt.getTime().toString(),
      source: options.source,
      createdAt: now.toString(),
    });
    await this.redis.hset(
      BOOST_META_KEY(userId),
      'guaranteedImpressions',
      '30',
    );
    await this.redis.expireat(
      BOOST_META_KEY(userId),
      Math.floor(expiresAt.getTime() / 1000),
    );
    await this.incrementDailyCount(userId);

    this.logger.log(
      `User ${userId} enqueued to boost queue (${options.source})`,
    );
  }

  async getBoostedUsers(limit = 2): Promise<number[]> {
    const now = Date.now();
    const ids = await this.redis.zrange(BOOST_QUEUE_KEY, 0, limit - 1);
    const valid: number[] = [];

    for (const id of ids) {
      const meta = await this.redis.hgetall(BOOST_META_KEY(Number(id)));
      if (!meta?.expiresAt || Number(meta.expiresAt) < now) {
        await this.redis.zrem(BOOST_QUEUE_KEY, id);
        continue;
      }
      valid.push(Number(id));
    }

    return valid;
  }

  async markShown(userId: number) {
    await this.redis.zincrby(BOOST_QUEUE_KEY, 3000, userId.toString());
    const meta = await this.redis.hgetall(BOOST_META_KEY(userId));
    const given = parseInt(meta.impressionsGiven || '0') + 1;
    await this.redis.hset(
      BOOST_META_KEY(userId),
      'impressionsGiven',
      given.toString(),
    );
  }

  async canShow(userId: number): Promise<boolean> {
    const last = await this.redis.hget(BOOST_META_KEY(userId), 'lastShownAt');
    if (!last) return true;
    return Date.now() - Number(last) >= 120_000;
  }

  async canEnqueue(userId: number): Promise<boolean> {
    const key = BOOST_DAILY_KEY(userId);
    const count = await this.redis.get(key);
    if (count && parseInt(count) >= this.MAX_BOOSTS_PER_DAY) {
      this.logger.warn(`User ${userId} exceeded daily boost limit`);
      return false;
    }
    return true;
  }

  private async incrementDailyCount(userId: number) {
    const key = BOOST_DAILY_KEY(userId);
    await this.redis.incr(key);
    await this.redis.expire(key, 86400);
  }

  async getDailyCount(userId: number): Promise<number> {
    const key = BOOST_DAILY_KEY(userId);
    const count = await this.redis.get(key);
    return count ? parseInt(count) : 0;
  }

  async remove(userId: number) {
    await this.redis.zrem(BOOST_QUEUE_KEY, userId.toString());
    await this.redis.del(BOOST_META_KEY(userId));
  }

  async getQueueLength(): Promise<number> {
    return this.redis.zcard(BOOST_QUEUE_KEY);
  }

  async getActiveBoosts(): Promise<ActiveBoost[]> {
    const ids = await this.redis.zrange(BOOST_QUEUE_KEY, 0, -1);
    const active: ActiveBoost[] = [];
    const now = Date.now();

    for (const id of ids) {
      const meta = await this.redis.hgetall(BOOST_META_KEY(Number(id)));
      if (meta?.expiresAt && Number(meta.expiresAt) > now) {
        active.push({
          userId: Number(id),
          strength: parseInt(meta.strength) || 1,
          expiresIn: Number(meta.expiresAt) - now,
        });
      }
    }

    return active;
  }

  async getActiveVipUsers(limit = 2): Promise<number[]> {
    const now = Date.now();
    const ids = await this.redis.zrange('vip:queue', 0, limit - 1);
    const valid: number[] = [];

    for (const id of ids) {
      const meta = await this.redis.hgetall(`vip:meta:${id}`);
      if (meta?.expiresAt && Number(meta.expiresAt) > now) {
        valid.push(Number(id));
      } else {
        await this.redis.zrem('vip:queue', id);
      }
    }

    return valid;
  }

  async getHighCreditUsers(limit = 2): Promise<number[]> {
    const ids = await this.redis.zrange('credit:queue', 0, limit - 1);
    return ids.map(Number);
  }

  async enqueueVip(userId: number, expiresAt: Date) {
    const now = Date.now();
    await this.redis.zadd('vip:queue', now.toString(), userId.toString());
    await this.redis.hset(`vip:meta:${userId}`, {
      expiresAt: expiresAt.getTime().toString(),
      createdAt: now.toString(),
      impressions: '0',
      guaranteedImpressions: '100',
    });
    await this.redis.expireat(
      `vip:meta:${userId}`,
      Math.floor(expiresAt.getTime() / 1000),
    );
  }

  async markShownVip(userId: number) {
    await this.redis.zincrby('vip:queue', 2000, userId.toString());
    await this.redis.hset(
      `vip:meta:${userId}`,
      'lastShownAt',
      Date.now().toString(),
    );
    const meta = await this.redis.hgetall(`vip:meta:${userId}`);
    const given = parseInt(meta.impressionsGiven || '0') + 1;
    await this.redis.hset(
      `vip:meta:${userId}`,
      'impressionsGiven',
      given.toString(),
    );
  }

  async enqueueHighCredit(userId: number, balance: number) {
    await this.redis.zadd(
      'credit:queue',
      balance.toString(),
      userId.toString(),
    );
    await this.redis.hset(`credit:meta:${userId}`, {
      balance: balance.toString(),
      createdAt: Date.now().toString(),
      guaranteedImpressions: '50',
      impressionsGiven: '0',
    });
  }

  async markShownCredit(userId: number) {
    await this.redis.zincrby('credit:queue', 2000, userId.toString());
    await this.redis.hset(
      `credit:meta:${userId}`,
      'lastShownAt',
      Date.now().toString(),
    );
    const meta = await this.redis.hgetall(`credit:meta:${userId}`);
    const given = parseInt(meta.impressionsGiven || '0') + 1;
    await this.redis.hset(
      `credit:meta:${userId}`,
      'impressionsGiven',
      given.toString(),
    );
  }
}
