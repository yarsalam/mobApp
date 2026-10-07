import { Inject, Injectable, Logger } from '@nestjs/common';
import { PhaseService } from '../../phase/phase.service';
import { DevicePhoneService } from 'src/auth/device-phone/device-phone.service';
import { VipService } from '../vip/vip.service';
import { PaywallResponse } from './paywall.types';
import { REDIS_CLIENT } from 'src/redis/redis.constants';
import Redis from 'ioredis';

const DEFAULT_PRODUCT_WEIGHTS = {
  boost: 1.0,
  credits: 1.0,
  vip: 1.0,
  bundle: 1.0,
};

const DEFAULT_TONE_WEIGHTS = {
  educational: 1.0,
  soft_sell: 1.0,
  hard_sell: 1.0,
};

@Injectable()
export class PaywallService {
  private readonly logger = new Logger(PaywallService.name);

  constructor(
    private readonly phaseService: PhaseService,
    private readonly devicePhoneService: DevicePhoneService,
    private readonly vipService: VipService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private async getProductWeight(product: string): Promise<number> {
    const stored = await this.redis.get(`paywall:weight:${product}`);
    return stored
      ? parseFloat(stored)
      : (DEFAULT_PRODUCT_WEIGHTS[product] ?? 1.0);
  }

  private async getToneWeight(tone: string): Promise<number> {
    const stored = await this.redis.get(`paywall:weight:tone:${tone}`);
    return stored ? parseFloat(stored) : (DEFAULT_TONE_WEIGHTS[tone] ?? 1.0);
  }

  async adjustWeights(
    phase: string,
    product: string,
    tone: string,
    reward: number,
  ): Promise<void> {
    const productKey = `paywall:weight:${product}`;
    const currentProduct = await this.getProductWeight(product);
    const newProduct = Math.max(0.1, currentProduct + 0.01 * reward);
    await this.redis.set(productKey, newProduct.toString());

    const toneKey = `paywall:weight:tone:${tone}`;
    const currentTone = await this.getToneWeight(tone);
    const newTone = Math.max(0.1, currentTone + 0.01 * reward);
    await this.redis.set(toneKey, newTone.toString());

    this.logger.log(
      `Paywall weights adjusted: phase=${phase}, product=${product} (${currentProduct.toFixed(2)}→${newProduct.toFixed(2)}), tone=${tone} (${currentTone.toFixed(2)}→${newTone.toFixed(2)})`,
    );
  }

  async handleColdPhase(deviceId: number, phone: string) {
    const devices = await this.devicePhoneService.countUniqueDevices(phone);
    const phones = await this.devicePhoneService.countUniquePhones(deviceId);

    if (devices > 1 || phones > 1) {
      return {
        type: 'block',
        message: 'برای ادامه، لطفاً شماره خود را تأیید کنید',
      };
    }

    return {
      type: 'educational',
      message:
        'با تکمیل پروفایل و Boost رایگان، شانس دیده‌شدن خود را افزایش دهید',
    };
  }

  async getPaywall(
    userId: number,
    reason: 'message' | 'wave',
  ): Promise<PaywallResponse | null> {
    const phase = await this.phaseService.get(userId);
    const hasVip = await this.vipService.hasVip(userId);
    if (hasVip) return null;

    const productWeights = await Promise.all(
      ['boost', 'credits', 'vip', 'bundle'].map((p) =>
        this.getProductWeight(p),
      ),
    );
    const toneWeights = await Promise.all(
      ['educational', 'soft_sell', 'hard_sell'].map((t) =>
        this.getToneWeight(t),
      ),
    );

    const products = ['boost', 'credits', 'vip', 'bundle'];
    const tones = ['educational', 'soft_sell', 'hard_sell'];

    const selectWeighted = (items: string[], weights: number[]) => {
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return items[i];
      }
      return items[0];
    };

    const bestProduct = selectWeighted(products, productWeights);
    const bestTone = selectWeighted(tones, toneWeights);

    return {
      title: this.generateTitle(bestProduct, bestTone, phase.everPaid),
      description: this.generateDescription(bestProduct, bestTone),
      tone: bestTone as any,
      primaryAction: {
        product: bestProduct as any,
        productId: this.getProductId(bestProduct),
        label: this.generateLabel(bestProduct, bestTone),
        highlight: true,
      },
      secondaryAction:
        bestProduct !== 'boost'
          ? { product: 'boost', productId: 'boost_1', label: 'Boost بزن' }
          : {
              product: 'credits',
              productId: 'credits_20',
              label: 'خرید اعتبار',
            },
    };
  }

  private generateTitle(
    product: string,
    tone: string,
    everPaid: boolean,
  ): string {
    const titles: Record<string, string> = {
      boost_educational: 'اولین قدم رو بردار! 🚀',
      boost_soft_sell: 'دیده شو! 🔥',
      boost_hard_sell: 'همین الان Boost کن! ⚡',
      credits_educational: 'اعتبار چیه؟ 💬',
      credits_soft_sell: 'گفتگو رو شروع کن 💰',
      credits_hard_sell: 'اعتبار محدود! ⏳',
      vip_educational: 'VIP چه مزایایی داره؟ 🤔',
      vip_soft_sell: 'VIP شو! ⭐',
      vip_hard_sell: 'فقط VIP! 👑',
      bundle_educational: 'بسته شروع 🎁',
      bundle_soft_sell: 'پکیج ویژه 🎀',
      bundle_hard_sell: 'بهترین فرصت! 🔥',
    };
    return titles[`${product}_${tone}`] || titles[`${product}_soft_sell`] || '';
  }

  private generateDescription(product: string, tone: string): string {
    return 'توضیحات متناسب با محصول و tone';
  }

  private generateLabel(product: string, tone: string): string {
    const labels: Record<string, string> = {
      boost_educational: 'می‌خوام امتحان کنم',
      boost_soft_sell: 'Boost کن',
      boost_hard_sell: 'همین الان',
      credits_educational: 'بیشتر بدونم',
      credits_soft_sell: 'اعتبار بگیر',
      credits_hard_sell: 'شارژ کن',
      vip_educational: 'اطلاعات بیشتر',
      vip_soft_sell: 'VIP فعال کن',
      vip_hard_sell: 'VIP شو',
      bundle_educational: 'شروع کن',
      bundle_soft_sell: 'پکیج رو بخر',
      bundle_hard_sell: 'همین الان',
    };
    return labels[`${product}_${tone}`] || labels[`${product}_soft_sell`] || '';
  }

  private getProductId(product: string): string {
    const ids: Record<string, string> = {
      boost: 'boost_1',
      credits: 'credits_20',
      vip: 'vip_month',
      bundle: 'starter_bundle',
    };
    return ids[product] || product;
  }
}
