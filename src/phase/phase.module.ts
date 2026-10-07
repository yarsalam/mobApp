import { Module } from '@nestjs/common';
import { PhaseService } from './phase.service';
import { PhaseRecalcService } from './phase-recalc.service';
import { PhaseOptimizerService } from './phase-optimizer.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserPhase } from './entities/user-phase.entity';
import { User } from 'src/users/entities/user.entity';
import { Payment } from 'src/payments/entities/payment.entity';
import { UserMetricsModule } from '../user-metrics/user-metrics.module';
import { RedisModule } from '../redis/redis.module';
import { FeatureStoreModule } from 'src/feature-store/feature-store.module';
import { PhaseController } from './phase.controller';
import { Interaction } from 'src/interaction/entities/interaction.entity';
import { Message } from 'src/message/entities/message.entity';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { PersonalityModule } from 'src/personality/personality.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserPhase,
      User,
      Payment,
      PartitionedEvent,
      Interaction,
      Message,
    ]),
    UserMetricsModule,
    RedisModule,
    FeatureStoreModule,
    PersonalityModule,
  ],
  providers: [PhaseService, PhaseRecalcService, PhaseOptimizerService],
  exports: [PhaseService],
  controllers: [PhaseController],
})
export class PhaseModule {}
