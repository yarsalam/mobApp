import { Module } from '@nestjs/common';
import { NotificationGateway } from './notification.gateway';
import { NotificationService } from './notification.service';
import { NotificationOrchestrator } from './orchestrator.notification';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppNotification } from './entities/notification.entity';
import { UserPushState } from './entities/user-push-state.entity';
import { NotificationController } from './notification.controller';
import { NotificationListener } from './notification.listener';
import { UserDevice } from 'src/user-device/entities/user-device.entity';
import { User } from 'src/users/entities/user.entity';
import { PushChannel } from './channels/push.channel';
import { ReengagementService } from './reengagement.service';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AppNotification, UserPushState, UserDevice, User]),
    RedisModule,
  ],
  providers: [
    NotificationGateway,
    NotificationService,
    NotificationOrchestrator,
    NotificationListener,
    PushChannel,
    ReengagementService,
  ],
  exports: [NotificationService, NotificationGateway, PushChannel],
  controllers: [NotificationController],
})
export class NotificationModule {}
