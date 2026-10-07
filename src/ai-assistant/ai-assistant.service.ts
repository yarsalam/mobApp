import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AssistantConversation } from './entities/assistant-conversation.entity';
import { AssistantMessage } from './entities/assistant-message.entity';
import { ProblemDetectorService } from './analyzers/problem-detector.service';
import { GuidanceGeneratorService } from './guidance/guidance-generator.service';
import { PhaseOptimizerService } from './optimizers/phase-optimizer.service';
import { UserContextService } from './context/user-context.service';
import { IntentDetectorService } from './intent/intent-detector.service';
import { OpenRouterClientService } from './llm/openrouter-client.service';
import { UserEventService } from '../user-event/user-event.service';
import { User } from 'src/users/entities/user.entity';
import { PaymentsService } from 'src/payments/payments.service';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    @InjectRepository(AssistantConversation)
    private convRepo: Repository<AssistantConversation>,

    @InjectRepository(AssistantMessage)
    private msgRepo: Repository<AssistantMessage>,

    @InjectRepository(User)
    private userRepo: Repository<User>,

    private readonly paymentsService: PaymentsService,
    private readonly problemDetector: ProblemDetectorService,
    private readonly guidanceGenerator: GuidanceGeneratorService,
    private readonly phaseOptimizer: PhaseOptimizerService,
    private readonly userContextService: UserContextService,
    private readonly intentDetector: IntentDetectorService,
    private readonly openRouter: OpenRouterClientService,
    private readonly userEventService: UserEventService,
  ) {}

  // ─── Advice ───────────────────────────────────────────────────────────────

  async getAdvice(userId: number) {
    const [problems, phase] = await Promise.all([
      this.problemDetector.detectProblems(userId),
      this.phaseOptimizer.getPhaseMetrics(userId),
    ]);

    const [guidance, plan] = await Promise.all([
      this.guidanceGenerator.getNextGuidanceWithData(userId, problems, phase),
      this.phaseOptimizer.createOptimizationPlanWithData(
        userId,
        problems,
        phase,
      ),
    ]);

    return {
      userId,
      timestamp: new Date().toISOString(),
      summary: {
        problemsCount: problems.length,
        hasCriticalProblem: problems.some((p) => p.severity === 'critical'),
        currentPhase: phase.phase,
        nextPhase: plan.targetPhase,
      },
      topProblems: problems.slice(0, 3),
      nextGuidance: guidance,
      optimizationPlan: plan,
    };
  }

  async getNextGuidance(userId: number) {
    const guidance = await this.guidanceGenerator.getNextGuidance(userId);
    if (!guidance) {
      return {
        hasGuidance: false,
        message: 'همه چی عالیه! به همین خوبی ادامه بده 🎉',
      };
    }
    return { hasGuidance: true, guidance };
  }

  async getOptimizationPlan(userId: number) {
    return this.phaseOptimizer.createOptimizationPlan(userId);
  }

  async getUserProblems(userId: number) {
    return this.problemDetector.detectProblems(userId);
  }

  // ─── Conversation ─────────────────────────────────────────────────────────

  async startConversation(userId: number, initialMessage?: string) {
    const conv = this.convRepo.create({
      user: { id: userId } as any,
      status: 'open',
    });
    await this.convRepo.save(conv);

    if (initialMessage) {
      await this.userSendsMessage(conv.id, userId, initialMessage);
    } else {
      // ← welcome ثابت، بدون context embed (کاهش هزینه + کاهش پیچیدگی)
      const welcomeMsg = this.msgRepo.create({
        conversation: conv,
        sender: 'assistant',
        content:
          'سلام! 👋 من دستیار یارسلام هستم.\nچطور می‌تونم کمکت کنم؟ می‌تونی درباره آمار، فاز، پروفایل یا هر چیز دیگه‌ای بپرسی.',
      });
      await this.msgRepo.save(welcomeMsg);
    }

    return conv;
  }

  /**
   * جریان اصلی پردازش پیام:
   *
   * ۱. بررسی ownership — conv متعلق به همین userId باشد
   * ۲. ذخیره پیام کاربر
   * ۳. Build Context + Detect Intent (موازی)
   * ۴. Rule-based response یا LLM
   * ۵. ذخیره پاسخ + log
   */
  async userSendsMessage(convId: number, userId: number, message: string) {
    const conv = await this.convRepo.findOne({
      where: { id: convId },
      relations: ['user', 'messages'],
      order: { messages: { createdAt: 'ASC' } },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    // ← Fix: ownership check
    if (conv.user.id !== userId) {
      throw new ForbiddenException('This conversation does not belong to you');
    }

    // ۱. ذخیره پیام کاربر
    const userMsg = this.msgRepo.create({
      conversation: conv,
      sender: 'user',
      content: message,
    });
    await this.msgRepo.save(userMsg);

    // ۲. Context
    const ctxResult = await Promise.allSettled([
      this.userContextService.build(userId),
    ]);
    const context =
      ctxResult[0].status === 'fulfilled' ? ctxResult[0].value : null;

    // ۳. Intent
    const intent = await this.intentDetector.detect(
      message,
      context ?? undefined,
    );
    this.logger.log(
      `Intent: ${intent.type} (needsLLM: ${intent.needsLLM}) for user ${userId}`,
    );

    // ۴. Response
    let response: string;
    let usedLLM = false;

    if (!intent.needsLLM && context) {
      const ruleResponse = this.intentDetector.buildRuleBasedResponse(
        intent,
        context,
      );
      if (ruleResponse) {
        response = ruleResponse;
      } else {
        response = await this.callLLM(message, context, conv.messages);
        usedLLM = true;
      }
    } else if (context) {
      response = await this.callLLM(message, context, conv.messages);
      usedLLM = true;
    } else {
      response =
        'متأسفم، در حال حاضر قادر به دریافت اطلاعات پروفایل شما نیستم. لطفاً دوباره تلاش کنید.';
    }

    // ۵. ذخیره پاسخ
    const assistantMsg = this.msgRepo.create({
      conversation: conv,
      sender: 'assistant',
      content: response,
      meta: { intent: intent.type, usedLLM },
    });
    await this.msgRepo.save(assistantMsg);

    // لاگ غیرهمزمان
    this.userEventService
      .log({
        userId,
        type: EventType.MESSAGE_SENT,
        metadata: { context: 'assistant', intent: intent.type, usedLLM },
      })
      .catch(() => {});

    return { message: response, intent: intent.type, usedLLM };
  }

  private async callLLM(
    userMessage: string,
    context: Awaited<ReturnType<UserContextService['build']>>,
    history: AssistantMessage[],
  ): Promise<string> {
    const recentHistory = history.slice(-5).map((m) => ({
      role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));
    return this.openRouter.ask({
      userMessage,
      contextString: this.userContextService.toPromptString(context),
      conversationHistory: recentHistory,
      maxTokens: 300,
    });
  }

  // ─── Premium Features ─────────────────────────────────────────────────────

  async getIcebreakers(
    userId: number,
    targetUserId: number,
  ): Promise<string[]> {
    const hasPremium = await this.paymentsService.hasActiveSubscription(
      userId,
      'assistant',
    );
    if (!hasPremium) return [];

    const [targetUser, ctx] = await Promise.all([
      this.userRepo.findOne({
        where: { id: targetUserId },
        select: ['aboutme', 'hobbies_self', 'values_self', 'city'],
      }),
      this.userContextService.build(userId).catch(() => null),
    ]);
    if (!targetUser) return [];

    if (ctx) {
      const prompt = `بر اساس این اطلاعات، ۳ جمله آغاز گفتگو (icebreaker) پیشنهاد بده:
طرف مقابل: شهر=${targetUser.city ?? 'نامشخص'}, علایق=${targetUser.hobbies_self?.join('، ') ?? 'نامشخص'}
درباره‌اش: ${targetUser.aboutme?.slice(0, 100) ?? 'خالی'}
فقط ۳ جمله کوتاه فارسی بنویس، هر جمله در یک خط`;

      const llmResponse = await this.openRouter.ask({
        userMessage: prompt,
        contextString: this.userContextService.toPromptString(ctx),
        maxTokens: 150,
      });
      return llmResponse
        .split('\n')
        .filter((l) => l.trim().length > 5)
        .slice(0, 3);
    }

    const icebreakers: string[] = [];
    if (targetUser.hobbies_self?.length) {
      icebreakers.push(
        `سلام! منم ${targetUser.hobbies_self[0]} رو دوست دارم. تو کجا این کارو میکنی؟`,
      );
    }
    if (targetUser.city) {
      icebreakers.push(
        `سلام! ${targetUser.city}ی هستی؟ منم چندبار اونجا بودم.`,
      );
    }
    return icebreakers;
  }

  /**
   * ← Fix: پارامتر convId اضافه شد تا context مکالمه موجود باشد
   */
  async suggestReply(
    userId: number,
    convId: number,
    message: string,
  ): Promise<string | null> {
    const hasPremium = await this.paymentsService.hasActiveSubscription(
      userId,
      'assistant',
    );
    if (!hasPremium) return null;

    const [ctx, conv] = await Promise.all([
      this.userContextService.build(userId).catch(() => null),
      this.convRepo.findOne({
        where: { id: convId, user: { id: userId } },
        relations: ['messages'],
        order: { messages: { createdAt: 'ASC' } },
      }),
    ]);
    if (!ctx) return null;

    // ۵ پیام آخر برای context مکالمه
    const recentHistory = (conv?.messages ?? []).slice(-5).map((m) => ({
      role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));

    return this.openRouter.ask({
      userMessage: `یک پاسخ کوتاه و طبیعی به این پیام پیشنهاد بده: "${message}"`,
      contextString: this.userContextService.toPromptString(ctx),
      conversationHistory: recentHistory,
      maxTokens: 80,
    });
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async listConversationsForUser(userId: number) {
    return this.convRepo.find({
      where: { user: { id: userId } },
      order: { updatedAt: 'DESC' },
      take: 20,
    });
  }

  async getConversation(convId: number, userId: number) {
    const conv = await this.convRepo.findOne({
      where: { id: convId },
      relations: ['user', 'messages'],
      order: { messages: { createdAt: 'ASC' } },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.user.id !== userId) throw new ForbiddenException();
    return conv;
  }
}
