import { Module } from '@nestjs/common';
import { VipService } from './vip.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserVip } from './entities/vip.entity';
import { UserEventModule } from 'src/user-event/user-event.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserVip]), UserEventModule],
  providers: [VipService],
  exports: [VipService],
})
export class VipModule {}
