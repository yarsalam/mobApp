import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../users/entities/user.entity';
import { Payment } from '../../../payments/entities/payment.entity';
import { UserBoost } from '../../../payments/boosts/entities/user-boost.entity';
import { UserVip } from '../../../payments/vip/entities/vip.entity';
import { UserCredits } from '../../../payments/credits/entities/user-credits.entity';
import { Report } from '../../../report-block/entities/report.entity';
import { ModerationLog } from '../../../moderation/entities/moderation-log.entity';
import { AiAssistantService } from '../../../ai-assistant/ai-assistant.service';
import { ProfileVisitor } from '../../../profile-visitors/entities/profile-visitor.entity';
import { Interaction } from '../../../interaction/entities/interaction.entity';
import { Message } from '../../../message/entities/message.entity';
import { UserImage } from '../../../user_images/entities/user_image.entity';

@Controller('admin-api/safety/users')
@UseGuards(AdminApiGuard)
export class SafetyUsersController {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,

    @InjectRepository(Payment)
    private paymentRepo: Repository<Payment>,

    @InjectRepository(UserBoost)
    private boostRepo: Repository<UserBoost>,

    @InjectRepository(UserVip)
    private vipRepo: Repository<UserVip>,

    @InjectRepository(UserCredits)
    private creditsRepo: Repository<UserCredits>,

    @InjectRepository(Report)
    private reportRepo: Repository<Report>,

    @InjectRepository(ModerationLog)
    private modLogRepo: Repository<ModerationLog>,

    @InjectRepository(ProfileVisitor)
    private visitorRepo: Repository<ProfileVisitor>,

    @InjectRepository(Interaction)
    private interactionRepo: Repository<Interaction>,

    @InjectRepository(Message)
    private messageRepo: Repository<Message>,

    @InjectRepository(UserImage)
    private imageRepo: Repository<UserImage>,

    private aiAssistantService: AiAssistantService,
  ) {}

  @Get(':id/profile')
  async getProfile(@Param('id') id: number) {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: ['userImages'],
    });
    if (!user) throw new Error('User not found');
    return user;
  }

  @Get(':id/images')
  async getImages(@Param('id') id: number) {
    return this.imageRepo.find({ where: { user: { id } } });
  }

  @Get(':id/activity')
  async getActivity(@Param('id') id: number) {
    const [visitors, interactionsSent, interactionsReceived, messages] =
      await Promise.all([
        this.visitorRepo.find({
          where: { visitorId: id }, // ← fix شد
          relations: ['profile'],
        }),
        this.interactionRepo.find({ where: { sender: { id } } }),
        this.interactionRepo.find({ where: { receiver: { id } } }),
        this.messageRepo.find({ where: { from: { id } } }),
      ]);
    return { visitors, interactionsSent, interactionsReceived, messages };
  }

  @Get(':id/financial')
  async getFinancial(@Param('id') id: number) {
    const [payments, boost, vip, credits] = await Promise.all([
      this.paymentRepo.find({ where: { user: { id } } }),
      this.boostRepo.findOne({ where: { user: { id } } }),
      this.vipRepo.findOne({ where: { userId: id } }),
      this.creditsRepo.findOne({ where: { userId: id } }),
    ]);
    return { payments, boost, vip, credits };
  }

  @Get(':id/reports')
  async getReports(@Param('id') id: number) {
    return this.reportRepo.find({ where: { reportedUser: { id } } });
  }

  @Get(':id/moderation-logs')
  async getModerationLogs(@Param('id') id: number) {
    return this.modLogRepo.find({ where: { userId: id } });
  }

  // ── در safety-users.controller.ts این متد را جایگزین getAiAdvice کن ──
  // getAdvice خروجی کامل آنالیز می‌دهد — باید به فرمت { tips, personality_summary } تبدیل شود

  @Get(':id/ai-advice')
  async getAiAdvice(@Param('id') id: number) {
    try {
      const advice = await this.aiAssistantService.getAdvice(id);

      // advice.topProblems → tips (راه‌حل‌های مشکلات)
      const tips: string[] = (advice?.topProblems ?? []).map(
        (p: any) => `${p.description} — ${p.solution}`,
      );

      // advice.summary → personality_summary
      const phase = advice?.summary?.currentPhase ?? 'cold';
      const phaseLabel =
        phase === 'cold' ? 'سرد' : phase === 'warm' ? 'گرم' : 'داغ';

      const problemsCount = advice?.summary?.problemsCount ?? 0;
      const hasCritical = advice?.summary?.hasCriticalProblem ?? false;

      const personality_summary = [
        `فاز فعلی کاربر: ${phaseLabel}`,
        hasCritical
          ? '⚠️ مشکل بحرانی در پروفایل شناسایی شده'
          : problemsCount > 0
            ? `${problemsCount} مشکل شناسایی‌شده در پروفایل`
            : '✅ پروفایل بدون مشکل مهم',
        advice?.optimizationPlan?.estimatedTimeToNextPhase
          ? `زمان تخمینی به فاز بعدی: ${advice.optimizationPlan.estimatedTimeToNextPhase}`
          : '',
      ]
        .filter(Boolean)
        .join(' — ');

      return { tips, personality_summary };
    } catch (error: any) {
      return { tips: [], personality_summary: null };
    }
  }

  @Post(':id/re-analyze')
  async reAnalyze(
    @Param('id') id: number,
    @Body() body: { bio: string; messages: string[] },
  ) {
    // aiAssistantService.getAdvice را با bio جدید صدا می‌زند
    // اگر سرویس از bio استفاده می‌کند آن را پاس بده
    return this.aiAssistantService.getAdvice(id);
  }

  @Post(':id/verify-face')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'selfie' }, { name: 'profile_photo' }]),
  )
  async verifyFace(
    @Param('id') id: number,
    @UploadedFiles()
    files: {
      selfie: Express.Multer.File[];
      profile_photo: Express.Multer.File[];
    },
  ) {
    // Placeholder – implement with ai_verification service
    return { verified: false, message: 'Manual verification required' };
  }
}
