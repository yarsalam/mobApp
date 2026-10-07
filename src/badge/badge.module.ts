import { Module } from '@nestjs/common';
import { BadgeController } from './badge.controller';
import { BadgeService } from './badge.service';
import { NotificationModule } from 'src/notification/notification.module';
import { MessageModule } from 'src/message/message.module';

@Module({
  imports: [NotificationModule, MessageModule],
  controllers: [BadgeController],
  providers: [BadgeService],
  exports: [BadgeService],
})
export class BadgeModule {}
