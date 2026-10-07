import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Delete,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { TrustScoreService } from 'src/trust/trust-score.service';
import { UserDeviceService } from 'src/user-device/user-device.service';
import { AiImageService } from 'src/ai-image/ai-image.service';
import { NotificationService } from 'src/notification/notification.service';
import { RelationStatusService } from 'src/relation-status/relation-status.service';
import { PersonalityService } from 'src/personality/personality.service';
import { BadgeService } from 'src/badge/badge.service';
import { UserMetricsService } from 'src/user-metrics/user-metrics.service';
import { FeatureService } from 'src/user-metrics/feature.service'; // ← اضافه شد
import { UserPhonesService } from 'src/user-phones/user-phones.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserDevice } from 'src/user-device/entities/user-device.entity';
import { UserPhone } from 'src/user-phones/entities/user-phone.entity';
import { NotificationType } from 'src/notification/entities/notification.entity';

@Controller('admin-api/safety/users')
@UseGuards(AdminApiGuard)
export class SafetyUserDetailController {
  constructor(
    private trustScoreService: TrustScoreService,
    private userDeviceService: UserDeviceService,
    private aiImageService: AiImageService,
    private notificationService: NotificationService,
    private relationStatusService: RelationStatusService,
    private personalityService: PersonalityService,
    private badgeService: BadgeService,
    private userMetricsService: UserMetricsService,
    private featureService: FeatureService, // ← اضافه شد
    private userPhonesService: UserPhonesService,

    @InjectRepository(UserDevice)
    private deviceRepo: Repository<UserDevice>,
    @InjectRepository(UserPhone)
    private phoneRepo: Repository<UserPhone>,
  ) {}

  // ── Trust ─────────────────────────────────────────────────────────
  @Get(':id/trust')
  async getTrust(@Param('id', ParseIntPipe) id: number) {
    const [trustScore, deviceRisk] = await Promise.all([
      this.trustScoreService.calculateTrustScore(id),
      this.trustScoreService.calculateDeviceRisk(id),
    ]);
    return { userId: id, trustScore, deviceRisk };
  }

  @Post(':id/trust/override')
  overrideTrust(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { score: number; reason: string },
  ) {
    return (this.trustScoreService as any).adminOverride(
      id,
      body.score,
      body.reason,
    );
  }

  // ── Devices ───────────────────────────────────────────────────────
  @Get(':id/devices')
  getDevices(@Param('id', ParseIntPipe) id: number) {
    return this.deviceRepo.find({
      where: { user: { id } },
      order: { createdAt: 'DESC' },
    });
  }

  @Post(':id/devices/:deviceId/flag')
  async flagDevice(
    @Param('deviceId') deviceId: string,
    @Body() body: { reason: string },
  ) {
    await this.deviceRepo.update({ deviceId }, {
      isFlagged: true,
      flagReason: body.reason,
    } as any);
    return { success: true };
  }

  @Delete(':id/devices/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeDevice(@Param('deviceId') deviceId: string) {
    await this.deviceRepo.update({ deviceId }, { isRevoked: true } as any);
  }

  // ── Phones ────────────────────────────────────────────────────────
  @Get(':id/phones')
  getPhones(@Param('id', ParseIntPipe) id: number) {
    return this.userPhonesService.getAllPhones(id);
  }

  @Post(':id/phones/:phoneId/block')
  async blockPhone(@Param('phoneId', ParseIntPipe) phoneId: number) {
    await this.phoneRepo.update(phoneId, { isBlocked: true } as any);
    return { success: true };
  }

  // ── Images ────────────────────────────────────────────────────────
  @Post(':id/images/:imageId/requeue')
  requeueImage(@Param('imageId', ParseIntPipe) imageId: number) {
    return (this.aiImageService as any).requeueForAnalysis(imageId);
  }

  @Patch(':id/images/:imageId/approve')
  approveImage(@Param('imageId', ParseIntPipe) imageId: number) {
    return (this.aiImageService as any).adminApprove(imageId);
  }

  @Patch(':id/images/:imageId/reject')
  rejectImage(
    @Param('imageId', ParseIntPipe) imageId: number,
    @Body() body: { reason?: string },
  ) {
    return (this.aiImageService as any).adminReject(imageId, body.reason);
  }

  @Delete(':id/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteImage(@Param('imageId', ParseIntPipe) imageId: number) {
    return (this.aiImageService as any).adminDelete(imageId);
  }

  // ── Notifications ─────────────────────────────────────────────────
  @Get(':id/notifications')
  getUserNotifications(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit = '20',
  ) {
    return (this.notificationService as any).getUserNotifications(id, +limit);
  }

  @Post(':id/notifications/send')
  sendNotification(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { title: string; body: string },
  ) {
    return this.notificationService.createNotification({
      user_id: id,
      type: NotificationType.SYSTEM,
      message: `${body.title}: ${body.body}`,
    });
  }

  // ── Relations ─────────────────────────────────────────────────────
  @Get(':id/relations')
  getRelations(
    @Param('id', ParseIntPipe) id: number,
    @Query('type') type?: string,
  ) {
    return (this.relationStatusService as any).findByUser(id, type, 100);
  }

  @Get(':id/relations/:targetId')
  getRelationBetween(
    @Param('id', ParseIntPipe) id: number,
    @Param('targetId', ParseIntPipe) targetId: number,
  ) {
    return (this.relationStatusService as any).findBetween(id, targetId);
  }

  @Delete(':id/relations/:targetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRelation(
    @Param('id', ParseIntPipe) id: number,
    @Param('targetId', ParseIntPipe) targetId: number,
  ) {
    return (this.relationStatusService as any).adminRemove(id, targetId);
  }

  // ── Personality ───────────────────────────────────────────────────
  @Get(':id/personality')
  getPersonality(@Param('id', ParseIntPipe) id: number) {
    return this.personalityService.analyzePersonality(id);
  }

  @Get(':id/personality/match-debug')
  debugMatch(
    @Param('id', ParseIntPipe) id: number,
    @Query('candidateId', ParseIntPipe) candidateId: number,
  ) {
    return (this.personalityService as any).debugMatch(id, candidateId);
  }

  @Patch(':id/personality')
  async updatePersonality(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, any>,
  ) {
    return (this.personalityService as any).adminUpdate
      ? (this.personalityService as any).adminUpdate(id, body)
      : (this.personalityService as any).repo.update({ userId: id }, body);
  }

  // ── Badges ────────────────────────────────────────────────────────
  @Get(':id/badges')
  getBadges(@Param('id', ParseIntPipe) id: number) {
    return this.badgeService.getBadges(id);
  }

  @Post(':id/badges')
  grantBadge(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { type: string; reason?: string },
  ) {
    return (this.badgeService as any).grantBadge(id, body.type, body.reason);
  }

  @Delete(':id/badges/:type')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeBadge(
    @Param('id', ParseIntPipe) id: number,
    @Param('type') type: string,
  ) {
    return (this.badgeService as any).revokeBadge(id, type);
  }

  // ── Metrics ───────────────────────────────────────────────────────
  @Get(':id/metrics')
  async getMetrics(@Param('id', ParseIntPipe) id: number) {
    // هر سه موازی اجرا می‌شوند — اگر یکی fail کند بقیه باز می‌گردند
    const [featResult, base7dResult, extraResult] = await Promise.allSettled([
      this.featureService.getUserFeatures(id), // از PartitionedEvent مستقیم
      this.userMetricsService.get7dMetrics(id), // از user_daily_metrics
      this.userMetricsService.buildExtraMetrics(id), // retentionDays, pastPayments
    ]);

    const feat = featResult.status === 'fulfilled' ? featResult.value : {};
    const base7d =
      base7dResult.status === 'fulfilled' ? base7dResult.value : {};
    const extra = extraResult.status === 'fulfilled' ? extraResult.value : {};

    return {
      // Business metrics تجمیعی ۷روزه
      ...base7d,
      ...extra,

      // ML / Feature metrics از eventهای واقعی
      engagement_score: (feat as any).engagement_score ?? 0,
      days_since_signup: (feat as any).days_since_signup ?? 0,
      swipe_velocity: (feat as any).swipe_velocity ?? 0,
      avg_session_time: (feat as any).avg_session_time ?? 0,
      session_depth: (feat as any).session_depth ?? 0,
      dismiss_rate: (feat as any).dismiss_rate ?? 0,
      promotion_ctr: (feat as any).promotion_ctr ?? 0,
      conversion_score: (feat as any).conversion_score ?? 0,
      last_purchase_days: (feat as any).last_purchase_days ?? 999,
      hour_of_day: (feat as any).hour_of_day ?? 0,
      is_weekend: (feat as any).is_weekend ?? 0,
    };
  }

  @Get(':id/metrics/summary')
  async getMetricsSummary(@Param('id', ParseIntPipe) id: number) {
    const [metrics, engagementSlope] = await Promise.all([
      this.userMetricsService.get7dMetrics(id),
      this.userMetricsService.getEngagementSlope(id),
    ]);
    return {
      userId: id,
      period: '7d',
      ...metrics,
      engagementSlope,
      engagementTrend:
        engagementSlope > 0.6
          ? 'rising'
          : engagementSlope < 0.4
            ? 'falling'
            : 'stable',
    };
  }
}
