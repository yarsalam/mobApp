import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrustScoreService } from './trust-score.service';
import { User } from 'src/users/entities/user.entity';
import { Report } from 'src/report-block/entities/report.entity';
import { UserEventModule } from 'src/user-event/user-event.module';
import { DevicePhoneModule } from 'src/auth/device-phone/device-phone.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Report]),
    UserEventModule,
    DevicePhoneModule,
  ],
  providers: [TrustScoreService],
  exports: [TrustScoreService],
})
export class TrustModule {}
