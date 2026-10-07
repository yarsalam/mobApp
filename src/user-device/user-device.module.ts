import { Module } from '@nestjs/common';
import { UserDeviceService } from './user-device.service';
import { UserDeviceController } from './user-device.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserDevice } from './entities/user-device.entity';
import { User } from 'src/users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserDevice, User])],
  providers: [UserDeviceService],
  controllers: [UserDeviceController],
  exports: [UserDeviceService],
})
export class UserDeviceModule {}
