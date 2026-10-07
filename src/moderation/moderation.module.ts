import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';

import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { ModerationProcessor } from './moderation.processor';
import { ModerationLog } from './entities/moderation-log.entity';
import { User } from '../users/entities/user.entity';
import { Message } from '../message/entities/message.entity';
import { UserEventModule } from '../user-event/user-event.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ModerationLog, User, Message]),
    HttpModule.register({ timeout: 5000, maxRedirects: 3 }),
    BullModule.registerQueue({ name: 'moderation' }),
    UserEventModule,
  ],
  controllers: [ModerationController],
  providers: [ModerationService, ModerationProcessor],
  exports: [ModerationService],
})
export class ModerationModule {}
