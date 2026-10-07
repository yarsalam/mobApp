import { Injectable, Logger } from '@nestjs/common';
import { PhaseService } from '../../phase/phase.service';
import { CreditsService } from '../credits/credits.service';
import { VipService } from '../vip/vip.service';
import { TrustScoreService } from 'src/trust/trust-score.service';
import { RevenueAttributionService } from '../credits/../../revenue/revenue-attribution.service';
import {
  evaluatePaywallPolicy,
  PaywallContext,
  PolicyResult,
} from './paywall-policy.engine';
import { PaywallException } from './paywall.exception';

export type PaywallAction = 'send_message' | 'wave';

export interface PaywallDecision {
  allowed: boolean;
  reason?: string;
  denyReason?: string;
  phase?: string;
  balance?: number;
  trustScore?: number;
  deviceRisk?: number;
}

/**
 * PaywallDecisionService — Orchestrator خالص
 *
 * این سرویس هیچ منطق تصمیم‌گیری در خودش ندارد. فقط:
 *   ۱. داده می‌گیرد (از سرویس‌های تخصصی)
 *   ۲. به PaywallPolicyEngine می‌دهد
 *   ۳. نتیجه را اجرا می‌کند (consume credits اگر لازم بود)
 *
 * جداسازی مفاهیم:
 *   Phase     → engagement (PhaseService)
 *   Trust     → ریسک هویت و دستگاه (TrustScoreService)
 *   LTV       → ارزش آینده (RevenueAttributionService)
 *   Credits   → موجودی (CreditsService)
 *   Decision  → PaywallPolicyEngine (تابع خالص)
 *
 * Phase فقط engagement است — pastPayments از فرمول فاز حذف شده.
 * Revenue و Trust جداگانه‌اند و فقط در اینجا (لایه تصمیم) با هم ترکیب می‌شوند.
 */
@Injectable()
export class PaywallDecisionService {
  private readonly logger = new Logger(PaywallDecisionService.name);

  constructor(
    private readonly phaseService: PhaseService,
    private readonly creditsService: CreditsService,
    private readonly vipService: VipService,
    private readonly trustScoreService: TrustScoreService,
  ) {}

  /**
   * بررسی و مصرف اعتبار در صورت لزوم — برای استفاده در MessageService.
   * این متد اتمیک نیست در سطح DB، اما توالی را در یک نقطه نگه می‌دارد.
   */
  async checkAndConsume(
    userId: number,
    amount: number,
    action: PaywallAction,
  ): Promise<PaywallDecision> {
    const ctx = await this.buildContext(userId, amount);
    const result = evaluatePaywallPolicy(ctx);

    this.logger.debug(
      `Paywall[${action}] user=${userId} phase=${ctx.phase} ` +
        `trust=${ctx.trustScore} deviceRisk=${ctx.deviceRisk} ` +
        `credits=${ctx.credits} vip=${ctx.vip} → ${result.allowed ? result.reason : result.denyReason}`,
    );

    if (!result.allowed) {
      throw new PaywallException({
        reason: result.denyReason,
        phase: ctx.phase,
        balance: ctx.credits,
      });
    }

    if (result.consumeCredits) {
      await this.creditsService.consume(userId, amount, action);
    }

    return {
      allowed: true,
      reason: result.reason,
      phase: ctx.phase,
      balance: ctx.credits,
      trustScore: ctx.trustScore,
      deviceRisk: ctx.deviceRisk,
    };
  }

  /**
   * نسخه فقط-خواندنی — برای UI قبل از ارسال.
   */
  async canPerformAction(
    userId: number,
    amount: number,
  ): Promise<PaywallDecision> {
    const ctx = await this.buildContext(userId, amount);
    const result = evaluatePaywallPolicy(ctx);

    return {
      allowed: result.allowed,
      reason: result.reason,
      denyReason: result.denyReason,
      phase: ctx.phase,
      balance: ctx.credits,
      trustScore: ctx.trustScore,
      deviceRisk: ctx.deviceRisk,
    };
  }

  /**
   * جمع‌آوری تمام سیگنال‌ها — هر سرویس مالک داده خودش است.
   * Promise.allSettled برای اینکه اگر یک سرویس fail کرد بقیه ادامه دهند.
   */
  private async buildContext(
    userId: number,
    creditAmount: number,
  ): Promise<PaywallContext> {
    const [phaseResult, creditsResult, vipResult, trustResult] =
      await Promise.allSettled([
        this.phaseService.get(userId),
        this.creditsService.get(userId),
        this.vipService.hasVip(userId),
        this.trustScoreService.getTrustContext(userId),
      ]);

    const phase =
      phaseResult.status === 'fulfilled' ? phaseResult.value.phase : 'cold';

    const credits =
      creditsResult.status === 'fulfilled' ? creditsResult.value.balance : 0;

    const vip = vipResult.status === 'fulfilled' ? vipResult.value : false;

    const trust =
      trustResult.status === 'fulfilled'
        ? trustResult.value
        : { trustScore: 50, deviceRisk: 50 };

    // لاگ خطاهای جزئی بدون crash کل flow
    if (phaseResult.status === 'rejected')
      this.logger.warn(
        `Phase fetch failed for ${userId}: ${phaseResult.reason}`,
      );
    if (trustResult.status === 'rejected')
      this.logger.warn(
        `Trust fetch failed for ${userId}: ${trustResult.reason}`,
      );

    return {
      phase,
      credits,
      vip,
      trustScore: trust.trustScore,
      deviceRisk: trust.deviceRisk,
    };
  }
}
