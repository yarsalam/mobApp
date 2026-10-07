import {
  Controller,
  Get,
  Patch,
  Param,
  ParseIntPipe,
  Body,
  Post,
  UseGuards,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { GetUser } from 'src/auth/decorator/get-user/get-user.decorator';
import { AdminApiGuard } from 'src/admin-api/guards/api-key.guard';
import {
  INTERACTION_TYPES,
  SYSTEM_TYPES,
} from './entities/notification.entity';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    // MessageService حذف شد
  ) {}

  @Get()
  getUserNotifications(@GetUser('id') userId: number) {
    return this.notificationService.getUserNotifications(userId);
  }

  @Patch('read/:id')
  markAsRead(
    @GetUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.notificationService.markAsRead(id, userId);
  }

  @Get('unread/count')
  async countUnread(@GetUser('id') userId: number) {
    const count = await this.notificationService.countUnread(userId);
    return { count };
  }

  @Post()
  @UseGuards(AdminApiGuard)
  create(@Body() dto: CreateNotificationDto) {
    return this.notificationService.createNotification(dto);
  }

  @Get('pending')
  async getPending(@GetUser('id') userId: number) {
    return this.notificationService.getPendingCount(userId);
  }

  @Get('interactions')
  getInteractions(@GetUser('id') userId: number) {
    return this.notificationService.getInteractions(userId);
  }

  @Get('system')
  getSystemNotifications(@GetUser('id') userId: number) {
    return this.notificationService.getSystemNotifications(userId);
  }

  @Get('interaction-count')
  async getInteractionCount(@GetUser('id') userId: number) {
    const count = await this.notificationService.getInteractionCount(userId);
    return { count };
  }

  @Get('system-count')
  async getSystemCount(@GetUser('id') userId: number) {
    const count = await this.notificationService.getSystemCount(userId);
    return { count };
  }

  @Patch('read-all/interactions')
  async markInteractionsRead(@GetUser('id') userId: number) {
    await this.notificationService.markAllRead(userId, INTERACTION_TYPES);
    return { success: true };
  }

  @Patch('read-all/system')
  async markSystemRead(@GetUser('id') userId: number) {
    await this.notificationService.markAllRead(userId, SYSTEM_TYPES);
    return { success: true };
  }
}
