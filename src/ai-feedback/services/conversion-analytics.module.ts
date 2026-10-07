import { Module } from '@nestjs/common';
import { ConversionAnalyticsService } from './conversion-analytics.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiFeedback } from '../entities/ai-feedback.entity';
import { Payment } from 'src/payments/entities/payment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AiFeedback, Payment])],
  providers: [ConversionAnalyticsService],
  exports: [ConversionAnalyticsService],
})
export class ConversionAnalyticsModule {}
