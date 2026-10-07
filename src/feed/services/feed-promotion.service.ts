import { Injectable, Logger, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { PromotionEngineService } from '../../payments/promotion-engine.service';
import { PromotionExposureService } from '../../payments/promotion-exposure.service';
import { UserEventService } from '../../user-event/user-event.service';
import { FeedItem, PromotionConfig } from '../types/feed.types';
import { FeedPhase } from '../types/feed-phase.interface';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class FeedPromotionService {
  private readonly logger = new Logger(FeedPromotionService.name);

  private readonly PROMOTION_TEMPLATES: Record<string, PromotionConfig> = {
    profile: {
      variant: 'profile',
      title: 'پروفایلت رو کامل کن!',
      subtitle: 'پروفایل کامل = ۵ برابر لایک بیشتر\nفقط چند دقیقه طول می‌کشه',
      ctaText: 'کامل کن',
      ctaColor: '#00BFFF',
      gradientColors: ['#383232', '#006994', '#1b1818'],
      titleColor: '#00BFFF',
      promoImage:
        'https://via.placeholder.com/300x360/00BFFF/000000?text=Complete+Profile+✨',
      navigationTarget: 'EditProfile',
    },
    boost: {
      variant: 'boost',
      title: 'دیده شو!',
      subtitle: '۳۰ دقیقه در صدر لیست\n۱۰ برابر بازدید بیشتر',
      ctaText: 'بوست بزن',
      ctaColor: '#FFD700',
      gradientColors: ['#383232', '#4a2c00', '#1b1818'],
      titleColor: '#FFD700',
      promoImage:
        'https://via.placeholder.com/300x360/FFD700/000000?text=Boost+Now+🔥',
      navigationTarget: 'Payment',
      navigationParams: { type: 'boost' },
    },
    vip: {
      variant: 'vip',
      title: 'VIP شو!',
      subtitle: 'لایک نامحدود + اولویت همیشگی\nبدون محدودیت و دیده شدن بیشتر',
      ctaText: 'VIP فعال کن',
      ctaColor: '#00FFAA',
      gradientColors: ['#383232', '#006400', '#1b1818'],
      titleColor: '#00FFAA',
      promoImage:
        'https://via.placeholder.com/300x360/00FFAA/000000?text=VIP+Unlimited+⭐',
      navigationTarget: 'Payment',
      navigationParams: { type: 'vip' },
    },
    credit: {
      variant: 'credit',
      title: 'اعتبار بیشتر؟',
      subtitle: 'پیام و سوپرلایک بیشتر\nهمین حالا شارژ کن',
      ctaText: 'اعتبار بگیر',
      ctaColor: '#FFAA00',
      gradientColors: ['#383232', '#8B4513', '#1b1818'],
      titleColor: '#FFAA00',
      promoImage:
        'https://via.placeholder.com/300x360/FFAA00/000000?text=Credits+Ready+💰',
      navigationTarget: 'Payment',
      navigationParams: { type: 'credit' },
    },
    bundle: {
      variant: 'credit',
      title: '🎁 بسته شروع',
      subtitle: '۲۰ اعتبار + ۲ بوست\n۵۰٪ تخفیف ویژه',
      ctaText: 'شروع کن',
      ctaColor: '#FFAA00',
      gradientColors: ['#383232', '#8B4513', '#1b1818'],
      titleColor: '#FFAA00',
      promoImage:
        'https://via.placeholder.com/300x360/FFAA00/000000?text=Starter+Bundle+✨',
      navigationTarget: 'Payment',
      navigationParams: { type: 'bundle' },
    },
  };

  constructor(
    private readonly promotionEngine: PromotionEngineService,
    private readonly exposureService: PromotionExposureService,
    private readonly userEventService: UserEventService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  getAllowedPromotionTypes(phase: FeedPhase): string[] {
    if (phase.vipActive) return [];

    let allowed: string[] = [];

    switch (phase.phase) {
      case 'cold':
        allowed = !phase.isCompleted ? ['profile'] : ['boost', 'credit', 'vip'];
        break;
      case 'warm':
        allowed = ['credit', 'boost'];
        break;
      case 'hot':
        allowed = phase.everPaid
          ? ['vip', 'credit']
          : ['vip', 'bundle', 'credit'];
        break;
      default:
        allowed = [];
    }

    if (phase.boostActive) {
      allowed = allowed.filter((t) => t !== 'boost');
    }

    return allowed;
  }

  private personalizePromotionContent(
    variant: string,
    phase: FeedPhase,
  ): PromotionConfig {
    const template = this.PROMOTION_TEMPLATES[variant];
    if (!template) return template;

    const personalized = { ...template };
    const userPhase = phase.phase || 'cold';
    const everPaid = phase.everPaid || false;

    switch (variant) {
      case 'boost':
        if (userPhase === 'cold') {
          personalized.title = 'اولین قدم رو بردار! 🚀';
          personalized.subtitle = 'با Boost رایگان، ۱۰ برابر بیشتر دیده شو';
          personalized.ctaText = 'امتحان می‌کنم';
        } else if (userPhase === 'warm') {
          personalized.title = 'دیده شو! 🔥';
          personalized.subtitle =
            '۳۰ دقیقه در صدر لیست • ۱۰ برابر بازدید بیشتر';
          personalized.ctaText = 'Boost کن';
        } else {
          personalized.title = everPaid
            ? 'حرفه‌ای شو! 👑'
            : 'اولین بار ویژه 🎁';
          personalized.subtitle = everPaid
            ? '۳۰ دقیقه صدرنشین باش و شانس مچ رو ببر بالا'
            : '۳۰ دقیقه طلایی • مخصوص تو';
          personalized.ctaText = everPaid ? 'Boost VIP' : 'شروع کن';
        }
        break;
      case 'vip':
        if (userPhase === 'cold') {
          personalized.title = 'VIP شدن چه مزایایی داره؟ 🤔';
          personalized.subtitle = 'ببین چرا VIP ها ۵ برابر بیشتر مچ می‌شن';
          personalized.ctaText = 'می‌خوام بدونم';
        } else if (userPhase === 'warm') {
          personalized.title = 'VIP شو! ⭐';
          personalized.subtitle = 'لایک نامحدود + اولویت همیشگی';
          personalized.ctaText = 'VIP فعال کن';
        } else {
          personalized.title = 'ارتقا به VIP طلایی! 👑';
          personalized.subtitle = 'بدون محدودیت، بدون توقف • مخصوص تو';
          personalized.ctaText = 'همین الان';
        }
        break;
      case 'credit':
        if (userPhase === 'cold') {
          personalized.title = 'اعتبار چیه؟ 💬';
          personalized.subtitle = 'با اعتبار می‌تونی به هرکی خواستی پیام بدی';
          personalized.ctaText = 'بیشتر بدون';
        } else if (userPhase === 'warm') {
          personalized.title = 'اعتبار بیشتری می‌خوای؟ 💰';
          personalized.subtitle = 'حرف‌های ناگفته رو بزن • پیام بفرست';
          personalized.ctaText = 'اعتبار بگیر';
        } else {
          personalized.title = 'شارژ سریع اعتبار ⚡';
          personalized.subtitle = 'پیام‌های نامحدود • مخصوص کاربران فعال';
          personalized.ctaText = 'شارژ کن';
        }
        break;
      case 'profile':
        personalized.title =
          userPhase === 'cold'
            ? 'پروفایلت رو بساز! ✨'
            : 'پروفایلت رو جذاب‌تر کن! 🎨';
        personalized.subtitle =
          userPhase === 'cold'
            ? 'با پروفایل کامل، ۵ برابر بیشتر دیده می‌شی'
            : 'عکس و توضیحات جدید = شانس بیشتر';
        personalized.ctaText =
          userPhase === 'cold' ? 'شروع می‌کنم' : 'ویرایش پروفایل';
        break;
    }

    return personalized;
  }

  async decideAndCreatePromotion(
    userId: number,
    allowedTypes: string[],
    phase: FeedPhase,
    feedPosition: number,
  ): Promise<FeedItem | null> {
    const decision = await this.promotionEngine.decide(userId, allowedTypes, {
      feed_position: feedPosition,
      phase: phase.phase,
      user_phase: phase,
    });

    if (!decision.variant) return null;

    const promotion = this.personalizePromotionContent(decision.variant, phase);
    const promotionId = randomUUID();

    // ذخیره متادیتا در Redis
    await this.redis.set(
      `promo:map:${promotionId}`,
      JSON.stringify({
        userId,
        variant: decision.variant,
        score: decision.score,
        phase: phase.phase,
        tone: 'soft_sell',
      }),
      'EX',
      3600,
    );

    // ردیابی و لاگ
    await this.exposureService.trackImpression(userId, decision.variant);
    await this.userEventService.log({
      userId,
      type: EventType.PROMOTION_SHOWN,
      metadata: {
        variant: decision.variant,
        score: decision.score,
        position: feedPosition,
        promotionId,
      },
    });

    return {
      id: promotionId,
      type: 'promotion',
      data: promotion,
      score: decision.score,
    };
  }

  async decideBatch(
    userId: number,
    allowedTypes: string[],
    phase: FeedPhase,
    positions: number[],
  ): Promise<(FeedItem | null)[]> {
    return Promise.all(
      positions.map((pos) =>
        this.decideAndCreatePromotion(userId, allowedTypes, phase, pos),
      ),
    );
  }
}
