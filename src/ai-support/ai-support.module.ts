import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';

import { SupportTicket } from './entities/ticket.entity';
import { TicketMessage } from './entities/ticket-message.entity';
import { TicketFeedback } from './entities/ticket-feedback.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import { TicketService } from './services/ticket.service';
import { AiSupportProcessor } from './processors/ai-support.processor';
import { UserEventModule } from 'src/user-event/user-event.module';
import { TicketController } from './ticket.controller';
import { QueuesModule } from 'src/queues/queues.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupportTicket,
      TicketMessage,
      TicketFeedback,
      TicketEvent,
    ]),
    HttpModule.register({ timeout: 60_000, maxRedirects: 3 }),
    UserEventModule,
    QueuesModule,
  ],
  controllers: [TicketController],
  providers: [TicketService, AiSupportProcessor],
  exports: [TicketService],
})
export class AiSupportModule {}
