import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { PhaseService } from '../../phase/phase.service';
import { AiImageService } from '../../ai-image/ai-image.service';
import { InteractionsService } from '../../interaction/interaction.service';
import { ProfileVisitorsService } from '../../profile-visitors/profile-visitors.service';
import { UserMetricsService } from '../../user-metrics/user-metrics.service';
import { PersonalityService } from '../../personality/personality.service';
import { TicketService } from 'src/ai-support/services/ticket.service';
import { UserProblem } from '../types/user-problem.interface';
import { ProblemDetectorPhase } from '../types/problem-detector-phase.interface';
import { UserImageAnalysis } from '../types/user-image-analysis.interface';
import { InteractionAnalysis } from '../types/interaction-analysis.interface';
import { UserMetricsSnapshot } from '../types/user-metrics-snapshot.interface';
import { PersonalityProfile } from '../types/personality-profile.interface';
import { FeedAssemblerService } from 'src/feed/services/feed-assembler.service';

@Injectable()
export class ProblemDetectorService {
  private readonly logger = new Logger(ProblemDetectorService.name);

  constructor(
    private readonly phaseService: PhaseService,
    private readonly aiImageService: AiImageService,
    private readonly interactionsService: InteractionsService,
    private readonly profileVisitorsService: ProfileVisitorsService,
    private readonly userMetricsService: UserMetricsService,
    private readonly personalityService: PersonalityService,
    private readonly feedAssembler: FeedAssemblerService,
    private readonly ticketService: TicketService,
  ) {}

  async detectProblems(userId: number): Promise<UserProblem[]> {
    const problems: UserProblem[] = [];

    const [
      phase,
      images,
      interactions,
      visitors,
      rawMetrics,
      rawPersonality,
      feed,
      supportTickets,
    ] = await Promise.all([
      this.phaseService.getPhaseMetrics(userId).catch(() => null),
      this.aiImageService.findByUser(userId).catch(() => []),
      this.interactionsService.getUserInteractions(userId).catch(() => []),
      this.profileVisitorsService.getProfileVisitors(userId).catch(() => []),
      this.userMetricsService.buildExtraMetrics(userId).catch(() => null),
      this.personalityService.analyzePersonality(userId).catch(() => null),
      this.feedAssembler.buildFeed(userId, { limit: 5 }).catch(() => []),
      this.ticketService.getUserTickets(userId).catch(() => []),
    ]);

    // مقدار پیش‌فرض برای phase (ممکن است null باشد)
    const safePhase: ProblemDetectorPhase = {
      isCompleted: false, // مقدار پیش‌فرض
      city: null,
      bio: null,
      phase: 'cold' as const,
      everPaid: false,
      suggestedActions: [],
      ...phase, // فیلدهای واقعی (مثل phase و score) روی پیش‌فرض‌ها نوشته می‌شوند
    } as ProblemDetectorPhase;

    // تبدیل عکس‌ها به UserImageAnalysis[]
    const userImages: UserImageAnalysis[] = images.map((img) => ({
      id: img.id,
      url: img.url,
      qualityScore: img.qualityScore ?? 0,
    }));

    // مقدار پیش‌فرض برای metrics و personality
    const metrics: UserMetricsSnapshot = {
      daysSinceSignup: (rawMetrics as any)?.daysSinceSignup ?? 0,
      lastPurchaseDays: (rawMetrics as any)?.lastPurchaseDays ?? 0,
    };

    const personality: PersonalityProfile =
      (rawPersonality as PersonalityProfile | null) ?? {
        ocean: { extraversion: 0.5 },
      };

    problems.push(
      ...(await this.detectProfileProblems(userId, safePhase, userImages)),
    );
    problems.push(...(await this.detectImageProblems(userId, userImages)));
    problems.push(
      ...(await this.detectEngagementProblems(
        userId,
        interactions,
        visitors,
        metrics,
      )),
    );
    problems.push(
      ...(await this.detectPersonalityProblems(
        userId,
        personality,
        interactions,
      )),
    );
    problems.push(...(await this.detectPhaseProblems(safePhase, metrics)));

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
        description: 'پروفایل شما ناقص است',
        reason: 'کاربران با پروفایل کامل ۵ برابر بیشتر دیده می‌شوند',
        solution: 'به بخش ویرایش پروفایل برو و اطلاعات خود را تکمیل کن',
        impact: '۵ برابر افزایش بازدید پروفایل',
      });
    }
    if (!phase.city) {
      problems.push({
        category: 'profile',
        severity: 'medium',
        description: 'شهر خود را مشخص نکرده‌ای',
        reason: 'کاربران همشهری راحت‌تر با هم ارتباط برقرار می‌کنند',
        solution: 'شهر خود را در پروفایل اضافه کن',
        impact: '۲ برابر افزایش مچ شدن با همشهری‌ها',
      });
    }
    if (!phase.bio || phase.bio.length < 50) {
      problems.push({
        category: 'profile',
        severity: 'medium',
        description: 'درباره من کوتاه است',
        reason: 'کاربران دوست دارند قبل از شروع گفتگو، کمی از طرف مقابل بدانند',
        solution: 'حداقل ۵۰ کلمه درباره خودت بنویس',
        impact: '۳ برابر افزایش پیام دریافتی',
      });
    }
    return problems;
  }

  private async detectImageProblems(
    _userId: number,
    images: UserImageAnalysis[],
  ): Promise<UserProblem[]> {
    const problems: UserProblem[] = [];
    if (images.length === 0) {
      problems.push({
        category: 'image',
        severity: 'critical',
        description: 'هیچ عکسی آپلود نکرده‌ای',
        reason: 'پروفایل‌های بدون عکس معمولاً دیده نمی‌شوند',
        solution: 'حداقل ۳ عکس با کیفیت از خودت آپلود کن',
        impact: '۱۰ برابر افزایش بازدید',
      });
    } else if (images.length < 3) {
      problems.push({
        category: 'image',
        severity: 'medium',
        description: 'تعداد عکس‌ها کم است',
        reason: 'کاربران با حداقل ۳ عکس، اعتماد بیشتری جلب می‌کنند',
        solution: 'حداقل ۳ عکس آپلود کن (ترجیحاً در محیط‌های مختلف)',
        impact: '۳ برابر افزایش لایک',
      });
    }
    const lowQualityImages = images.filter((img) => img.qualityScore < 0.5);
    if (lowQualityImages.length > 0) {
      problems.push({
        category: 'image',
        severity: 'medium',
        description: 'بعضی عکس‌ها کیفیت پایینی دارند',
        reason: 'عکس‌های باکیفیت بیشتر جلب توجه می‌کنند',
        solution: 'عکس‌های با کیفیت‌تر و واضح‌تر آپلود کن',
        impact: '۲ برابر افزایش نرخ لایک',
      });
    }
    return problems;
  }

  private async detectEngagementProblems(
    _userId: number,
    interactions: InteractionAnalysis[],
    visitors: unknown[],
    metrics: UserMetricsSnapshot,
  ): Promise<UserProblem[]> {
    const problems: UserProblem[] = [];
    const likeCount = interactions.filter((i) => i.type === 'like').length;
    const messageCount = interactions.filter(
      (i) => i.type === 'message',
    ).length;
    const viewCount = visitors.length;

    const daysSinceSignup = metrics.daysSinceSignup ?? 0;
    if (likeCount < 5 && daysSinceSignup > 3) {
      problems.push({
        category: 'engagement',
        severity: 'high',
        description: 'لایک کافی نداری',
        reason: 'کاربران فعال‌تر بیشتر دیده می‌شوند',
        solution: 'روزانه حداقل ۵ نفر رو لایک کن',
        impact: 'افزایش ۳ برابری بازدید از پروفایل تو',
      });
    }
    if (messageCount === 0 && daysSinceSignup > 7) {
      problems.push({
        category: 'engagement',
        severity: 'critical',
        description: 'هنوز هیچ پیامی نفرستاده‌ای',
        reason: 'هدف اصلی آشنایی، گفتگوست',
        solution: 'به ۳ نفری که لایک کردی پیام بده',
        impact: 'شروع ارتباطات واقعی',
      });
    }
    const viewToLikeRatio = viewCount > 0 ? likeCount / viewCount : 0;
    if (viewCount > 20 && viewToLikeRatio < 0.1) {
      problems.push({
        category: 'engagement',
        severity: 'medium',
        description: 'نرخ تبدیل بازدید به لایک پایین است',
        reason: 'احتمالاً پروفایل یا عکس‌ها جذاب نیستند',
        solution: 'عکس اصلی را عوض کن یا درباره‌ات را جذاب‌تر بنویس',
        impact: '۲ برابر افزایش لایک',
      });
    }
    return problems;
  }

  private async detectPersonalityProblems(
    _userId: number,
    personality: PersonalityProfile,
    interactions: InteractionAnalysis[],
  ): Promise<UserProblem[]> {
    const problems: UserProblem[] = [];
    if (!personality) return problems;

    const messages = interactions.filter((i) => i.type === 'message');
    if (messages.length > 0) {
      const negativeMessages = messages.filter(
        (m) => m.sentiment === 'negative',
      );
      if (negativeMessages.length / messages.length > 0.3) {
        problems.push({
          category: 'personality',
          severity: 'high',
          description: 'لحن پیام‌هایت ممکن است کمی تند باشد',
          reason: 'پیام‌های منفی باعث کاهش پاسخگویی می‌شوند',
          solution: 'سعی کن با لحن مهربان‌تر و مثبت‌تر صحبت کنی',
          impact: '۳ برابر افزایش پاسخگویی',
        });
      }
    }

    const extraversion = personality.ocean?.extraversion ?? 0.5;
    if (extraversion < 0.3) {
      problems.push({
        category: 'personality',
        severity: 'low',
        description: 'به نظر می‌رسد کمی خجالتی هستی',
        reason: 'افراد خجالتی معمولاً دیرتر ارتباط برقرار می‌کنند',
        solution: 'با پیام‌های کوتاه و ساده شروع کن، مثلاً "سلام، حالت چطوره؟"',
        impact: 'افزایش ۵۰٪ شروع مکالمه',
      });
    }
    return problems;
  }

  private async detectPhaseProblems(
    phase: ProblemDetectorPhase,
    metrics: UserMetricsSnapshot,
  ): Promise<UserProblem[]> {
    const problems: UserProblem[] = [];
    if (!phase) return problems;

    const lastPurchaseDays = metrics.lastPurchaseDays ?? 0;

    switch (phase.phase) {
      case 'cold':
        problems.push({
          category: 'phase',
          severity: 'high',
          description: 'در فاز اولیه هستی',
          reason: 'با تکمیل پروفایل و چند تعامل ساده، وارد فاز گرم می‌شی',
          solution: phase.suggestedActions?.[0] || 'پروفایلت رو کامل کن',
          impact: 'وارد شدن به فاز گرم و دیده شدن بیشتر',
        });
        break;
      case 'warm':
        if (!phase.everPaid) {
          problems.push({
            category: 'payment',
            severity: 'medium',
            description: 'زمان خرید نزدیک است',
            reason: 'کاربران فعال معمولاً برای امکانات بیشتر خرید می‌کنند',
            solution: 'با خرید اعتبار، می‌تونی پیام‌های بیشتری بفرستی',
            impact: 'دسترسی به امکانات ویژه',
          });
        }
        break;
      case 'hot':
        if (phase.everPaid && lastPurchaseDays > 30) {
          problems.push({
            category: 'payment',
            severity: 'medium',
            description: 'مدتی است خریدی نداشته‌ای',
            reason: 'کاربران وفادار با خرید مکرر، امکانات بیشتری دارن',
            solution: 'پکیج VIP با ۲۰٪ تخفیف ویژه تو',
            impact: 'لایک نامحدود و اولویت در نمایش',
          });
        }
        break;
    }
    return problems;
  }
}
