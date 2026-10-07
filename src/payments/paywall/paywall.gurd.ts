import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CreditsService } from '../credits/credits.service';
import { PhaseService } from '../../phase/phase.service';
import { BoostService } from '../boosts/boosts.service';

@Injectable()
export class PaywallGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private creditsService: CreditsService,
    private boostService: BoostService,
    private phaseService: PhaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<{
      credits?: number;
      boost?: boolean;
    }>('paywall', context.getHandler());

    if (!meta) return true;

    const req = context.switchToHttp().getRequest();
    const userId = req.user.id;

    const phase = await this.phaseService.get(userId);
    req.paywall = null;

    if (meta.credits) {
      const credits = await this.creditsService.get(userId);
      if (credits.balance < meta.credits) {
        req.paywall = {
          type: 'credits',
          required: meta.credits,
          balance: credits.balance,
          phase: phase.phase,
        };
        return true; // Soft Paywall — endpoint اجرا می‌شود، client تصمیم می‌گیرد
      }
    }

    if (meta.boost) {
      const boost = await this.boostService.get(userId);
      if (boost.instantCount <= 0) {
        req.paywall = { type: 'boost', phase: phase.phase };
        return true;
      }
    }

    return true;
  }
}
