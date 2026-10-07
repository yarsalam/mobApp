import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpsController } from './ops.controller';
import { OpsHealthService } from './ops.health.service';
import { TraceInterceptor } from './trace.interceptor';
import { RequestLog } from './entities/request-log.entity';
import { QueuesModule } from 'src/queues/queues.module';

@Module({
  imports: [TypeOrmModule.forFeature([RequestLog]), QueuesModule],
  controllers: [OpsController],
  providers: [OpsHealthService, TraceInterceptor],
  exports: [OpsHealthService, TraceInterceptor],
})
export class OpsModule {}
