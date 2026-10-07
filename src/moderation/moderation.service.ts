import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout } from 'rxjs';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { User } from '../users/entities/user.entity';
import { Message } from '../message/entities/message.entity';
import { UserEventService } from '../user-event/user-event.service';
import { ModerationLog } from './entities/moderation-log.entity';
import { EventType } from 'src/user-event/type/event-type.enum';

export interface ModerationResult {
  isSafe: boolean;
  confidence: number;
  flags: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: 'allow' | 'block' | 'flag_for_admin' | 'pending';
}

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  // Circuit Breaker state
  private circuitOpen = false;
  private circuitOpenUntil: Date = new Date();
  private failureCount = 0;
  private readonly FAILURE_THRESHOLD = 5;
  private readonly CIRCUIT_TIMEOUT = 60_000;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(ModerationLog)
    private readonly logRepo: Repository<ModerationLog>,
    private readonly userEventService: UserEventService,
    private readonly httpService: HttpService,
    @InjectQueue('moderation') private moderationQueue: Queue,
  ) {}

  async moderateMessage(
    message: string,
    senderId: number,
    receiverId: number,
    context?: { ip?: string; userAgent?: string },
  ): Promise<ModerationResult> {
    if (this.isCircuitOpen()) {
      this.logger.warn('Circuit is open, using fallback');
      return this.fallbackModeration(message, senderId);
    }

    try {
      const response = await firstValueFrom(
        this.httpService
          .post(`${process.env.AI_MODERATION_URL}/moderate`, {
            text: message,
            sender_id: senderId,
            receiver_id: receiverId,
          })
          .pipe(timeout(3000)),
      );

      this.failureCount = 0;
      const result = response.data;

      await this.saveModerationLog(senderId, message, result);

      if (result.severity !== 'low') {
        await this.handleViolation(senderId, result);
      }

      return { ...result, action: this.determineAction(result) };
    } catch (error: unknown) {
      this.failureCount++;
      if (this.failureCount >= this.FAILURE_THRESHOLD) {
        this.openCircuit();
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Moderation failed: ' + message);

      // ارسال به صف با تنظیمات مناسب برای جلوگیری از memory leak
      await this.moderationQueue.add(
        'process-later',
        { message, senderId, receiverId, timestamp: new Date() },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      );

      return this.fallbackModeration(message, senderId);
    }
  }

  async moderateMessageAsync(
    message: string,
    senderId: number,
    receiverId: number,
    messageId?: number,
  ): Promise<void> {
    await this.moderationQueue.add(
      'moderate-async',
      { message, senderId, receiverId, messageId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  }

  private fallbackModeration(
    message: string,
    senderId: number,
  ): ModerationResult {
    const scamPatterns = [
      /شماره\s*کارت/i,
      /بیا\s*تلگرام/i,
      /کارت\s*به\s*کارت/i,
    ];

    for (const pattern of scamPatterns) {
      if (pattern.test(message)) {
        return {
          isSafe: false,
          confidence: 0.7,
          flags: ['scam_attempt_fallback'],
          severity: 'high',
          action: 'block',
        };
      }
    }

    return {
      isSafe: true,
      confidence: 0.6,
      flags: ['no_ai_check'],
      severity: 'low',
      action: 'allow',
    };
  }

  private isCircuitOpen(): boolean {
    if (!this.circuitOpen) return false;
    if (new Date() > this.circuitOpenUntil) {
      this.circuitOpen = false;
      this.failureCount = 0;
      this.logger.log('Circuit closed again');
    }
    return this.circuitOpen;
  }

  private openCircuit(): void {
    this.circuitOpen = true;
    this.circuitOpenUntil = new Date(Date.now() + this.CIRCUIT_TIMEOUT);
    this.logger.warn(`Circuit opened until ${this.circuitOpenUntil}`);
  }

  private async handleViolation(userId: number, result: any): Promise<void> {
    const recentViolations = await this.logRepo.count({
      where: {
        userId,
        severity: result.severity,
        createdAt: MoreThan(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      },
    });

    if (result.severity === 'critical') {
      await this.applyRestrictions(userId, 'critical', recentViolations);
      await this.adjustTrustScore(userId, -30);
    } else if (result.severity === 'high') {
      if (recentViolations > 2) {
        await this.applyRestrictions(userId, 'high', recentViolations);
      }
      await this.adjustTrustScore(userId, -10);
    } else if (result.severity === 'medium') {
      await this.adjustTrustScore(userId, -5);
    }

    await this.userEventService.log({
      userId,
      type: EventType.USER_VIOLATION,
      metadata: {
        severity: result.severity,
        flags: result.flags,
        recentViolations,
      },
    });
  }

  private async applyRestrictions(
    userId: number,
    severity: string,
    violationCount: number,
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return;

    const restrictionDays =
      severity === 'critical' ? 7 + violationCount * 2 : violationCount * 3;

    user.canSendMessage = false;
    user.restrictedUntil = new Date(
      Date.now() + restrictionDays * 24 * 60 * 60 * 1000,
    );
    user.trustScore = Math.max(
      0,
      (user.trustScore || 50) - 20 * (violationCount + 1),
    );

    await this.userRepo.save(user);
    this.logger.log(`User ${userId} restricted for ${restrictionDays} days`);
  }

  private async adjustTrustScore(userId: number, delta: number) {
    await this.userRepo
      .createQueryBuilder()
      .update(User)
      .set({
        trustScore: () => `GREATEST(0, LEAST(100, "trustScore" + ${delta}))`,
      })
      .where('id = :id', { id: userId })
      .execute();
  }

  private determineAction(result: any): 'allow' | 'block' | 'flag_for_admin' {
    switch (result.severity) {
      case 'low':
        return 'allow';
      case 'medium':
        return 'allow';
      case 'high':
        return 'block';
      case 'critical':
        return 'block';
      default:
        return 'allow';
    }
  }

  private async saveModerationLog(
    userId: number,
    message: string,
    result: any,
  ) {
    try {
      // هش پیام برای حریم خصوصی
      const messageHash = createHash('sha256').update(message).digest('hex');
      // پیشوند masked برای debug
      const messagePreview = message
        .substring(0, 20)
        .replace(/\d{4,}/g, '****');

      const log = this.logRepo.create({
        userId,
        messageHash,
        messagePreview,
        isSafe: result.is_safe,
        confidence: result.confidence,
        severity: result.severity,
        flags: result.flags || [],
        processingTimeMs: result.processing_time_ms,
        ipAddress: result.ip,
        userAgent: result.user_agent,
      });

      await this.logRepo.save(log);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to save moderation log: ' + message);
    }
  }

  private async alertAdmin(alert: any) {
    this.logger.warn(`🚨 ADMIN ALERT: ${JSON.stringify(alert)}`);
  }

  async getUserRiskProfile(userId: number) {
    return { risk: 0, level: 'low' };
  }

  async getDailyStats(userId: number) {
    return {};
  }

  async getHighRiskUsers(limit: number, minSeverity: string) {
    return {};
  }

  async unblockUser(userId: number) {
    return {};
  }

  async exportReportsToCsv(start: Date, end: Date) {
    return {};
  }

  async healthCheck() {
    return {};
  }
}
