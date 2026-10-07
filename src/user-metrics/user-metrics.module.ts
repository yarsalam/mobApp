import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../payments/entities/payment.entity';
import { User } from '../users/entities/user.entity';
import { UserEventModule } from '../user-event/user-event.module';

// سرویس‌ها
import { UserMetricsService } from './user-metrics.service';
import { FeatureService } from './feature.service';
import { DailyMetricsService } from './daily-metrics.service';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, User, PartitionedEvent]), // ✅ همه entityها اینجا
    UserEventModule,
  ],
  providers: [UserMetricsService, FeatureService, DailyMetricsService],
  exports: [
    UserMetricsService,
    FeatureService, // ✅ هر دو رو export کن
  ],
})
export class UserMetricsModule {}
