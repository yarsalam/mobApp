import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AiFeedbackService } from './ai-feedback.service';
import { AiFeedbackController } from './ai-feedback.controller';
import { AiFeedbackProcessor } from './ai-feedback.processor';
import { AiFeedback } from './entities/ai-feedback.entity';
import { UserEventModule } from 'src/user-event/user-event.module';
import { ConversionAnalyticsModule } from './services/conversion-analytics.module';
import { QueuesModule } from 'src/queues/queues.module';
import { ConversionProcessor } from './processors/conversion.processor';
import { User } from 'src/users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiFeedback, User]),
    BullModule.registerQueue(
      { name: 'ai-feedback' },
      { name: 'conversion-analysis' }, // ثبت صف دوم
    ),
    UserEventModule,
    QueuesModule,
    ConversionAnalyticsModule,
  ],
  controllers: [AiFeedbackController],
  providers: [
    AiFeedbackService,
    AiFeedbackProcessor,
    ConversionProcessor, // رجیستر processor
  ],
  exports: [AiFeedbackService],
})
export class AiFeedbackModule {}
