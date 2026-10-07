import { forwardRef, Module } from '@nestjs/common';
import { BoostService } from './boosts.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserBoost } from './entities/user-boost.entity';
import { PhaseModule } from '../../phase/phase.module';
import { UserEventModule } from 'src/user-event/user-event.module';
import { BoostController } from './boostController';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserBoost]),
    PhaseModule,
    UserEventModule,
  ],
  providers: [BoostService],
  exports: [BoostService],
  controllers: [BoostController],
})
export class BoostsModule {}
