import { Module } from '@nestjs/common';
import { NotificationGateway } from './notification.gateway';
import { NotificationService } from './notification.service';
import { NotificationOrchestrator } from './orchestrator.notification';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppNotification } from './entities/notification.entity';
import { UserPushState } from './entities/user-push-state.entity';
import { NotificationController } from './notification.controller';
import { NotificationListener } from './notification.listener';

@Module({
  imports: [TypeOrmModule.forFeature([AppNotification, UserPushState])],
  providers: [
    NotificationGateway,
    NotificationService,
    NotificationOrchestrator,
    NotificationListener,
  ],
  exports: [NotificationService, NotificationGateway],
  controllers: [NotificationController],
})
export class NotificationModule {}
