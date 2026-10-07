import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevicePhone } from './entities/device-phone.entity';
import { DevicePhoneService } from './device-phone.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DevicePhone]), // 🔥 حیاتی
  ],
  providers: [DevicePhoneService],
  exports: [DevicePhoneService], // 👈 برای استفاده در AuthService
})
export class DevicePhoneModule {}
