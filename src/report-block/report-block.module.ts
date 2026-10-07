import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Block } from './entities/block.entity';
import { Report } from './entities/report.entity';
import { ReportBlockService } from './report-block.service';
import { ReportBlockController } from './report-block.controller';
import { UserEventModule } from 'src/user-event/user-event.module';
import { User } from 'src/users/entities/user.entity';
import { FeatureStoreModule } from 'src/feature-store/feature-store.module';
import { TrustModule } from 'src/trust/trust.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Block, Report, User]),
    UserEventModule,
    FeatureStoreModule,
    TrustModule,
  ],
  controllers: [ReportBlockController],
  providers: [ReportBlockService],
  exports: [ReportBlockService],
})
export class ReportBlockModule {}
