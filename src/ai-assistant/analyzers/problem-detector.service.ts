import { Injectable } from '@nestjs/common';
import { PhaseService } from '../../phase/phase.service';
import { AiImageService } from '../../ai-image/ai-image.service';
import { InteractionsService } from '../../interaction/interaction.service';
import { UserMetricsService } from '../../user-metrics/user-metrics.service';
import { UserProblem } from '../types/user-problem.interface';
import { ProblemDetectorPhase } from '../types/problem-detector-phase.interface';
import { UserImageAnalysis } from '../types/user-image-analysis.interface';
import { InteractionAnalysis } from '../types/interaction-analysis.interface';
import { UserMetricsSnapshot } from '../types/user-metrics-snapshot.interface';

@Injectable()
export class ProblemDetectorService {
  constructor(
    private readonly phaseService: PhaseService,
    private readonly aiImageService: AiImageService,
    private readonly interactionsService: InteractionsService,
    private readonly userMetricsService: UserMetricsService,
  ) {}

  async detectProblems(userId: number): Promise<UserProblem[]> {
    const [phaseResult, imageResult, interactionsResult, metricsResult] =
      await Promise.allSettled([
        this.phaseService.getPhaseMetrics(userId),
        this.aiImageService.findByUser(userId),
        this.interactionsService.getUserInteractions(userId),
        this.userMetricsService.buildExtraMetrics(userId),
      ]);

    const phase =
      phaseResult.status === 'fulfilled' && phaseResult.value
        ? (phaseResult.value as ProblemDetectorPhase)
        : null;
    const images =
      imageResult.status === 'fulfilled' && Array.isArray(imageResult.value)
        ? imageResult.value
        : null;
    const interactions =
      interactionsResult.status === 'fulfilled' &&
      Array.isArray(interactionsResult.value)
        ? (interactionsResult.value as InteractionAnalysis[])
        : null;
    const rawMetrics =
      metricsResult.status === 'fulfilled' && metricsResult.value
        ? metricsResult.value
        : null;

    const metrics: UserMetricsSnapshot | null = rawMetrics
      ? {
          daysSinceSignup:
            typeof (rawMetrics as any).daysSinceSignup === 'number' &&
            Number.isFinite((rawMetrics as any).daysSinceSignup)
              ? (rawMetrics as any).daysSinceSignup
              : undefined,
          lastPurchaseDays:
            typeof (rawMetrics as any).lastPurchaseDays === 'number' &&
            Number.isFinite((rawMetrics as any).lastPurchaseDays)
              ? (rawMetrics as any).lastPurchaseDays
              : undefined,
        }
      : null;

    const userImages: UserImageAnalysis[] = (images ?? []).map((img) => ({
      id: img.id,
      url: img.url,
      qualityScore:
        typeof img.qualityScore === 'number' && Number.isFinite(img.qualityScore)
          ? img.qualityScore
          : null,
    }));

    const problems: UserProblem[] = [];
    if (phase) {
      problems.push(...(await this.detectProfileProblems(userId, phase, userImages)));
    }
    if (images) {
      problems.push(...(await this.detectImageProblems(userImages)));
    }
    if (interactions && metrics) {
      problems.push(...(await this.detectEngagementProblems(userId, interactions, metrics)));
    }
    if (phase && metrics) {
      problems.push(...(await this.detectPhaseProblems(phase, metrics)));
    }

    return problems.sort((a, b) => {
      const severityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
      return severityWeight[b.severity] - severityWeight[a.severity];
    });
  }

  private async detectProfileProblems(
    _userId: number,
    phase: ProblemDetectorPhase,
    _images: UserImageAnalysis[],
  ): Promise<UserProblem[]> {
    const problems: UserProblem[] = [];
    if (!phase.isCompleted) {
      problems.push({
        category: 'profile',
        severity: 'high',
        description: 'پروفایل شما هنوز کامل نشده است',
        reason: 'وضعیت ثبت‌شده پروفایل نشان می‌دهد بخشی از اطلاعات اصلی تکمیل نشده است.',
        solution: 'بخش‌های ناقص را در صفحه ویرایش پروفایل تکمیل کن.',
        impact: 'اطلاعات بیشتری برای شناخت اولیه در اختیار بازدیدکننده قرار می‌گیرد؛ اثر عددی آن هنوز اندازه‌گیری نشده است.',
      });
    }
    if (!phase.city) {
      problems.push({
        category: 'profile',
        severity: 'medium',
        description: 'شهر در پروفایل ثبت نشده است',
        reason: 'اطلاعات مکانی پروفایل ناقص است.',
        solution: 'در صورت تمایل، شهر خود را در پروفایل ثبت کن.',
        impact: 'اطلاعات لازم برای تجربه‌ها و پیشنهادهای مکانی فراهم می‌شود؛ افزایش Match تضمین‌شده نیست.',
      });
    }
    if (!phase.bio || phase.bio.trim().length < 50) {
      problems.push({
        category: 'profile',
        severity: 'medium',
        description: 'بخش درباره‌من خالی یا کوتاه است',
        reason: 'بخش درباره‌من اطلاعات کمی برای شناخت علایق و ارزش‌های تو ارائه می‌کند.',
        solution: 'چند جمله واقعی درباره علایق، ارزش‌ها و انتظاراتت اضافه کن.',
        impact: 'توضیحات پروفایل کامل‌تر می‌شود؛ اثر آن بر تعداد پیام یا Match هنوز اندازه‌گیری نشده است.',
      });
    }
    return problems;
  }

  private async detectImageProblems(images: UserImageAnalysis[]): Promise<UserProblem[]> {
    const problems: UserProblem[] = [];
    if (images.length === 0) {
      problems.push({
        category: 'image',
        severity: 'high',
        description: 'هنوز عکسی برای پروفایل ثبت نشده است',
        reason: 'در حال حاضر تصویری برای نمایش در پروفایل وجود ندارد.',
        solution: 'یک عکس واضح و متعلق به خودت اضافه کن.',
        impact: 'پروفایل دارای محتوای تصویری می‌شود؛ اثر عددی آن بر بازدید یا لایک هنوز اندازه‌گیری نشده است.',
      });
    } else if (images.length < 3) {
      problems.push({
        category: 'image',
        severity: 'low',
        description: 'تعداد عکس‌های پروفایل محدود است',
        reason: 'با عکس‌های بیشتر می‌توانی جنبه‌های بیشتری از خودت را نشان بدهی.',
        solution: 'در صورت تمایل عکس‌های واقعی دیگری از موقعیت‌های متفاوت اضافه کن.',
        impact: 'محتوای تصویری پروفایل متنوع‌تر می‌شود؛ افزایش لایک یا بازدید تضمین‌شده نیست.',
      });
    }
    const hasLowScoredImages = images.some(
      (image) =>
        typeof image.qualityScore === 'number' &&
        Number.isFinite(image.qualityScore) &&
        image.qualityScore < 0.5,
    );
    if (hasLowScoredImages) {
      problems.push({
        category: 'image',
        severity: 'medium',
        description: 'امتیاز داخلی کیفیت بعضی عکس‌ها پایین است',
        reason: 'سامانه ارزیابی داخلی برای دست‌کم یک عکس امتیاز کمتر از آستانه ثبت کرده است.',
        solution: 'عکس را از نظر وضوح، نور و مشخص‌بودن سوژه بازبینی کن.',
        impact: 'کیفیت تصویری قابل‌مشاهده بهتر می‌شود؛ اثر آن بر تعامل هنوز اندازه‌گیری نشده است.',
      });
    }
    return problems;
  }

  private async detectEngagementProblems(
    _userId: number,
    interactions: InteractionAnalysis[],
    metrics: UserMetricsSnapshot,
  ): Promise<UserProblem[]> {
    const problems: UserProblem[] = [];
    const messageCount = interactions.filter((item) => item.type === 'message').length;
    const daysSinceSignup = metrics.daysSinceSignup;
    if (messageCount === 0 && typeof daysSinceSignup === 'number' && daysSinceSignup > 7) {
      problems.push({
        category: 'engagement',
        severity: 'medium',
        description: 'هنوز پیام ارسالی ثبت نشده است',
        reason: 'در تاریخچه تعاملات ثبت‌شده پیامی از طرف کاربر دیده نمی‌شود.',
        solution: 'اگر فردی با علایق مشترک دیدی، می‌توانی گفتگو را با یک پیام محترمانه شروع کنی.',
        impact: 'شروع گفتگو می‌تواند تجربه آشنایی را آغاز کند؛ نرخ پاسخ یا نتیجه آن هنوز قابل پیش‌بینی نیست.',
      });
    }
    return problems;
  }

  private async detectPhaseProblems(
    phase: ProblemDetectorPhase,
    metrics: UserMetricsSnapshot,
  ): Promise<UserProblem[]> {
    const problems: UserProblem[] = [];
    if (phase.phase === 'cold' && !phase.isCompleted) {
      problems.push({
        category: 'phase',
        severity: 'medium',
        description: 'حساب در فاز اولیه ثبت شده است',
        reason: 'فاز فعلی سامانه Cold ثبت شده است؛ این طبقه‌بندی به‌تنهایی نتیجه تعامل را پیش‌بینی نمی‌کند.',
        solution: 'ابتدا اطلاعات واقعی پروفایل را تکمیل کن.',
        impact: 'تکمیل اطلاعات، ورودی‌های پروفایل را کامل‌تر می‌کند؛ زمان تغییر فاز تضمین‌شده نیست.',
      });
    }
    if (
      phase.phase === 'hot' &&
      phase.everPaid &&
      typeof metrics.lastPurchaseDays === 'number' &&
      metrics.lastPurchaseDays > 30
    ) {
      problems.push({
        category: 'payment',
        severity: 'medium',
        description: 'بیش از ۳۰ روز از آخرین خرید ثبت‌شده گذشته است',
        reason: 'فاصله از آخرین خرید یک نشانه رفتاری است و به‌تنهایی دلیل خرید مجدد نیست.',
        solution: 'در صورت نیاز، محصولات و شرایط فعلی را بررسی کن.',
        impact: 'قیمت یا تخفیف واجدشرایط باید از پیشنهاد فعال و معتبر دریافت شود.',
      });
    }
    return problems;
  }
}
