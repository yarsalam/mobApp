import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
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
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/entities/notification.entity';

export interface ModerationResult {
  isSafe: boolean;
  confidence: number;
  flags: string[];
  warning?: string;
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
    private readonly notificationService: NotificationService,
    @InjectQueue('moderation') private moderationQueue: Queue,
  ) {}

  async moderateMessage(
    message: string,
    senderId: number,
    receiverId: number,
    context?: { ip?: string; userAgent?: string },
    acknowledged = false,
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

      const result = this.normalizeModerationResult(response.data);

      // پیام medium تا قبل از تأیید، ارسال و جریمه نمی‌شود.
      // بعد از تأیید، نتیجه دوباره بررسی و تخلف ثبت می‌شود.
      const awaitingConfirmation =
        result.severity === 'medium' && !acknowledged;

      if (!awaitingConfirmation) {
        await this.saveModerationLog(senderId, message, result);

        if (result.severity !== 'low') {
          await this.handleViolation(senderId, result);
        }
      }

      return {
        ...result,
        action: result.action === 'pending' ? 'pending' : this.determineAction(result),
        warning:
          result.severity === 'medium'
            ? 'هشدار: پیام شما محتوای نامناسب دارد. تکرار این رفتار می‌تواند باعث کاهش نمایش پروفایل و پیشنهادهای کمتر شود؛ حتی Boost نیز این محدودیت‌ها را خنثی نمی‌کند.'
            : result.severity === 'high'
              ? 'پیام به دلیل محتوای نامناسب مسدود شد. تکرار تخلف ممکن است محدودیت بیشتری ایجاد کند.'
              : result.severity === 'critical'
                ? 'تخلف جدی تشخیص داده شد. ممکن است محدودیت امنیتی روی حساب شما اعمال شود.'
                : undefined,
      };
    } catch (error: unknown) {
      this.failureCount++;

      if (this.failureCount >= this.FAILURE_THRESHOLD) {
        this.openCircuit();
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error('Moderation failed: ' + errorMessage);

      try {
        await this.moderationQueue.add(
          'process-later',
          {
            message,
            senderId,
            receiverId,
            timestamp: new Date(),
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        );
      } catch (queueError: unknown) {
        const queueErrorMessage =
          queueError instanceof Error ? queueError.message : String(queueError);

        this.logger.error(
          'Failed to enqueue moderation retry: ' + queueErrorMessage,
        );
      }

      // همیشه متن اصلی کاربر را بررسی کن، نه متن خطای سرویس را.
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
    _senderId: number,
  ): ModerationResult {
    const suspiciousPatterns = [
      /شماره\s*کارت/i,
      /کارت\s*به\s*کارت/i,
      /بیا\s*تلگرام/i,
    ];

    const suspicious = suspiciousPatterns.some((pattern) =>
      pattern.test(message),
    );

    if (suspicious) {
      return {
        isSafe: false,
        confidence: 0.7,
        flags: ['suspected_scam_fallback'],
        severity: 'high',
        action: 'block',
        warning: 'پیام تا بررسی امنیتی مسدود شد.',
      };
    }

    return {
      isSafe: false,
      confidence: 0,
      flags: ['moderation_unavailable'],
      severity: 'low',
      action: 'pending',
      warning:
        'بررسی امنیتی موقتاً در دسترس نیست؛ پیام تا تکمیل بررسی ارسال نمی‌شود.',
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

    const violationCountIncludingCurrent = recentViolations + 1;

    if (result.severity === 'critical') {
      await this.applyRestrictions(
        userId,
        'critical',
        violationCountIncludingCurrent,
      );

      await this.adjustTrustScore(userId, -30);
    } else if (result.severity === 'high') {
      if (violationCountIncludingCurrent >= 3) {
        await this.applyRestrictions(
          userId,
          'high',
          violationCountIncludingCurrent,
        );
      }

      await this.adjustTrustScore(userId, -10);
    } else if (result.severity === 'medium') {
      await this.adjustTrustScore(userId, -5);
    }

    if (result.severity === 'critical') {
      const totalViolations = await this.logRepo.count({
        where: {
          userId,
          severity: In(['medium', 'high', 'critical']),
          createdAt: MoreThan(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
        },
      });

      await this.alertAdmin({
        userId,
        severity: result.severity,
        totalViolations,
        periodDays: 30,
        flags: result.flags ?? [],
        occurredAt: new Date().toISOString(),
      });
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
        isSafe: result.isSafe ?? result.is_safe ?? false,
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

  private async alertAdmin(alert: {
    userId: number;
    severity: string;
    totalViolations: number;
    periodDays: number;
    flags: string[];
    occurredAt: string;
  }): Promise<void> {
    const adminIds = (process.env.ADMIN_USER_IDS ?? '')
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isSafeInteger(id) && id > 0);

    const message =
      `🚨 تخلف محتوایی بحرانی\n` +
      `شناسه کاربر: ${alert.userId}\n` +
      `تعداد تخلفات محتوایی در ${alert.periodDays} روز اخیر: ${alert.totalViolations}\n` +
      `شدت: ${alert.severity}\n` +
      `پرچم‌ها: ${alert.flags.join(', ') || 'نامشخص'}\n` +
      `زمان: ${alert.occurredAt}`;

    if (adminIds.length === 0) {
      this.logger.error(`ADMIN_USER_IDS is not configured. Alert: ${message}`);
      return;
    }

    const results = await Promise.allSettled(
      adminIds.map((user_id) =>
        this.notificationService.createNotification({
          user_id,
          type: NotificationType.SECURITY,
          message,
        }),
      ),
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Failed to notify admin ${adminIds[index]} about critical moderation violation`,
        );
      }
    });
  }

  private normalizeModerationResult(value: unknown): ModerationResult {
    if (!value || typeof value !== 'object') {
      throw new Error('Invalid moderation response');
    }

    const raw = value as Record<string, unknown>;

    const reason = typeof raw.reason === 'string' ? raw.reason : undefined;
    const unavailable =
      reason === 'moderation_unavailable' ||
      raw.layer === 'semantic_unavailable';

    const rawAllowed =
      typeof raw.allowed === 'boolean'
        ? raw.allowed
        : typeof raw.isSafe === 'boolean'
          ? raw.isSafe
          : typeof raw.is_safe === 'boolean'
            ? raw.is_safe
            : undefined;

    if (rawAllowed === undefined) {
      throw new Error('Invalid moderation safety flag');
    }

    const severity: ModerationResult['severity'] = this.isValidSeverity(raw.severity)
      ? raw.severity
      : unavailable
        ? 'low'
        : rawAllowed
          ? 'low'
          : reason === 'violence_keyword'
            ? 'high'
            : 'medium';

    const parsedConfidence = Number(raw.confidence);
    const confidence =
      Number.isFinite(parsedConfidence) && parsedConfidence >= 0 && parsedConfidence <= 1
        ? parsedConfidence
        : rawAllowed
          ? 1
          : 0;

    const flags = Array.isArray(raw.flags)
      ? raw.flags.filter(
          (flag): flag is string =>
            typeof flag === 'string' && flag.length <= 100,
        )
      : reason
        ? [reason]
        : [];

    if (raw.flags !== undefined && !Array.isArray(raw.flags)) {
      throw new Error('Invalid moderation flags');
    }

    if (typeof raw.matched === 'string' && raw.matched.length <= 100) {
      flags.push(`matched:${raw.matched}`);
    }

    return {
      isSafe: rawAllowed,
      confidence,
      flags,
      severity,
      action: unavailable ? 'pending' : this.determineAction({ severity }),
    };
  }

  private isValidSeverity(
    value: unknown,
  ): value is ModerationResult['severity'] {
    return (
      typeof value === 'string' &&
      ['low', 'medium', 'high', 'critical'].includes(value)
    );
  }

  async getUserRiskProfile(userId: number) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        canSendMessage: true,
        restrictedUntil: true,
      },
    });
    if (!user) {
      throw new NotFoundException(`User ${userId} was not found`);
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [total, logs] = await Promise.all([
      this.logRepo.count({ where: { userId, createdAt: MoreThan(since) } }),
      this.logRepo.find({
        where: { userId, createdAt: MoreThan(since) },
        order: { createdAt: 'DESC' },
        take: 500,
      }),
    ]);

    const severityCounts: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    const weights: Record<string, number> = {
      low: 0,
      medium: 5,
      high: 20,
      critical: 40,
    };
    let riskPoints = 0;
    const flagCounts = new Map<string, number>();

    for (const log of logs) {
      if (Object.prototype.hasOwnProperty.call(severityCounts, log.severity)) {
        severityCounts[log.severity]++;
      }
      riskPoints += weights[log.severity] ?? 0;
      for (const flag of Array.isArray(log.flags) ? log.flags : []) {
        if (typeof flag === 'string') {
          flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
        }
      }
    }

    const hasEvidence = total > 0;
    const riskScore = hasEvidence ? Math.min(100, riskPoints) : null;
    const level =
      riskScore === null
        ? 'unknown'
        : riskScore >= 60
          ? 'critical'
          : riskScore >= 35
            ? 'high'
            : riskScore >= 10
              ? 'medium'
              : 'low';

    return {
      userId,
      status: hasEvidence ? 'computed' : 'insufficient_data',
      risk: riskScore,
      level,
      method: 'rule_based_moderation_log_counts_v1',
      periodDays: 30,
      evidenceCount: total,
      analyzedEvidenceCount: logs.length,
      severityCounts,
      topFlags: [...flagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([flag, count]) => ({ flag, count })),
      lastViolationAt: logs[0]?.createdAt ?? null,
      account: {
        status: user.status ?? null,
        canSendMessage: user.canSendMessage,
        restrictedUntil: user.restrictedUntil ?? null,
      },
      limitations:
        total > logs.length
          ? ['Only the latest 500 moderation records were used in the breakdown.']
          : [],
      note: 'This is a transparent rule-based summary of recorded moderation outcomes, not a calibrated ML risk probability.',
    };
  }

  async getDailyStats(days: number = 7) {
    const requestedDays = Number(days);
    const periodDays =
      Number.isFinite(requestedDays) && Number.isInteger(requestedDays)
        ? Math.min(90, Math.max(1, requestedDays))
        : 7;
    const from = new Date(Date.now() - (periodDays - 1) * 24 * 60 * 60 * 1000);
    from.setHours(0, 0, 0, 0);
    const parameters = {
      low: 'low',
      medium: 'medium',
      high: 'high',
      critical: 'critical',
    };

    const rows = await this.logRepo
      .createQueryBuilder('log')
      .select('DATE(log.createdAt)', 'date')
      .addSelect('COUNT(*)', 'total')
      .addSelect('SUM(CASE WHEN log.severity = :low THEN 1 ELSE 0 END)', 'low')
      .addSelect('SUM(CASE WHEN log.severity = :medium THEN 1 ELSE 0 END)', 'medium')
      .addSelect('SUM(CASE WHEN log.severity = :high THEN 1 ELSE 0 END)', 'high')
      .addSelect('SUM(CASE WHEN log.severity = :critical THEN 1 ELSE 0 END)', 'critical')
      .where('log.createdAt >= :from', { from })
      .setParameters(parameters)
      .groupBy('DATE(log.createdAt)')
      .orderBy('date', 'ASC')
      .getRawMany();

    const byDay = rows.map((row) => ({
      date: String(row.date),
      total: Number(row.total ?? 0),
      low: Number(row.low ?? 0),
      medium: Number(row.medium ?? 0),
      high: Number(row.high ?? 0),
      critical: Number(row.critical ?? 0),
    }));
    const totals = byDay.reduce(
      (acc, row) => ({
        total: acc.total + row.total,
        low: acc.low + row.low,
        medium: acc.medium + row.medium,
        high: acc.high + row.high,
        critical: acc.critical + row.critical,
      }),
      { total: 0, low: 0, medium: 0, high: 0, critical: 0 },
    );

    return {
      periodDays,
      from: from.toISOString(),
      to: new Date().toISOString(),
      totals,
      byDay,
    };
  }

  async getHighRiskUsers(limit: number, minSeverity: string) {
    const severityOrder = ['low', 'medium', 'high', 'critical'];
    const thresholdIndex = severityOrder.indexOf(minSeverity);
    if (thresholdIndex < 0) {
      throw new BadRequestException('minSeverity must be one of low, medium, high, critical');
    }
    const allowedSeverities = severityOrder.slice(thresholdIndex);
    const parsedLimit = Number(limit);
    const safeLimit =
      Number.isFinite(parsedLimit) && Number.isInteger(parsedLimit)
        ? Math.min(100, Math.max(1, parsedLimit))
        : 20;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const rows = await this.logRepo
      .createQueryBuilder('log')
      .select('log.userId', 'userId')
      .addSelect('COUNT(*)', 'violationCount')
      .addSelect('MAX(log.createdAt)', 'lastViolationAt')
      .addSelect(
        'SUM(CASE WHEN log.severity = :medium THEN 5 WHEN log.severity = :high THEN 20 WHEN log.severity = :critical THEN 40 ELSE 0 END)',
        'riskPoints',
      )
      .where('log.createdAt >= :since', { since })
      .andWhere('log.severity IN (:...severities)', {
        severities: allowedSeverities,
      })
      .setParameters({ medium: 'medium', high: 'high', critical: 'critical' })
      .groupBy('log.userId')
      .orderBy('riskPoints', 'DESC')
      .addOrderBy('lastViolationAt', 'DESC')
      .take(safeLimit)
      .getRawMany();

    if (rows.length === 0) return [];

    const ids = rows
      .map((row) => Number(row.userId))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    if (ids.length === 0) return [];

    const users = await this.userRepo
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.nickname',
        'user.status',
        'user.canSendMessage',
        'user.restrictedUntil',
      ])
      .where('user.id IN (:...ids)', { ids })
      .getMany();
    const userById = new Map(users.map((user) => [user.id, user]));

    return rows.flatMap((row) => {
      const userId = Number(row.userId);
      const user = userById.get(userId);
      if (!user) return [];
      const risk = Math.min(100, Math.max(0, Number(row.riskPoints ?? 0)));
      return [{
        userId,
        nickname: user.nickname ?? null,
        risk,
        level: risk >= 60 ? 'critical' : risk >= 35 ? 'high' : risk >= 10 ? 'medium' : 'low',
        violationCount: Number(row.violationCount ?? 0),
        lastViolationAt: row.lastViolationAt ?? null,
        status: user.status ?? null,
        canSendMessage: user.canSendMessage,
        restrictedUntil: user.restrictedUntil ?? null,
        method: 'rule_based_moderation_log_counts_v1',
      }];
    });
  }

  async unblockUser(userId: number) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error(`User ${userId} was not found`);
    }
    if (
      user.status === 'admin_blocked' ||
      user.status === 'suspended' ||
      user.blockedAt ||
      user.blockReason
    ) {
      return {
        userId,
        unblocked: false,
        reason: 'account_status_requires_separate_admin_review',
        status: user.status ?? null,
      };
    }

    const previousCanSendMessage = user.canSendMessage;
    user.canSendMessage = true;
    user.restrictedUntil = undefined;
    await this.userRepo.save(user);
    await this.userEventService.log({
      userId,
      type: EventType.USER_UNBLOCKED,
      metadata: {
        source: 'moderation_admin_action',
        previousCanSendMessage,
      },
    });

    return {
      userId,
      unblocked: true,
      canSendMessage: user.canSendMessage,
      restrictedUntil: user.restrictedUntil ?? null,
    };
  }

  async exportReportsToCsv(start: Date, end: Date) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (
      !Number.isFinite(startDate.getTime()) ||
      !Number.isFinite(endDate.getTime()) ||
      startDate > endDate
    ) {
      throw new BadRequestException('A valid start and end date range is required');
    }

    const rows = await this.logRepo
      .createQueryBuilder('log')
      .where('log.createdAt BETWEEN :start AND :end', {
        start: startDate,
        end: endDate,
      })
      .orderBy('log.createdAt', 'ASC')
      .take(10000)
      .getMany();

    const csvCell = (value: unknown): string => {
      const raw =
        value === null || value === undefined
          ? ''
          : typeof value === 'string'
            ? value
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value);
      const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const headers = [
      'id',
      'userId',
      'severity',
      'isSafe',
      'confidence',
      'flags',
      'messageHash',
      'createdAt',
    ];
    const records = rows.map((row) =>
      [
        row.id,
        row.userId,
        row.severity,
        row.isSafe,
        row.confidence,
        row.flags,
        row.messageHash,
        row.createdAt?.toISOString?.() ?? row.createdAt,
      ]
        .map(csvCell)
        .join(','),
    );
    return [headers.join(','), ...records].join('\r\n');
  }

  async healthCheck() {
    let database: 'ok' | 'unavailable' = 'ok';
    try {
      await this.logRepo.query('SELECT 1');
    } catch {
      database = 'unavailable';
    }
    const status =
      database === 'ok' && !this.circuitOpen ? 'ok' : 'degraded';
    return {
      status,
      database,
      moderationCircuit: this.circuitOpen ? 'open' : 'closed',
      circuitOpenUntil: this.circuitOpenUntil.toISOString(),
      aiModerationConfigured: Boolean(process.env.AI_MODERATION_URL),
      aiModerationProbe: 'not_performed',
      checkedAt: new Date().toISOString(),
    };
  }
}
